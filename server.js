import express from 'express';
import multer from 'multer';
import csvParser from 'csv-parser';
import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import pLimit from 'p-limit';
import stringSimilarity from 'string-similarity';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.static("./"));

// Serve the HTML form
app.get('/', (req, res) => {
  res.sendFile(path.resolve('index.html'));
});

// Function to fetch HTML from a URL
async function fetchHTML(url) {
  try {
    if (!/^https?:\/\//i.test(url)) {
      if (url.startsWith('www.')) {
        url = 'https://' + url;
      } else {
        url = 'https://' + url;
      }
    }
    const response = await axios.get(url);
    return { html: response.data, error: null };
  } catch (error) {
    console.error(`Failed to fetch HTML from ${url}:`, error.message);
    return { html: null, error: error.message };
  }
}

app.get('/progress', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send progress updates
  let progress = 0;
  const interval = setInterval(() => {
    progress += 10;
    res.write(`data: ${progress}\n\n`);

    // End the stream after 100%
    if (progress >= 100) {
      clearInterval(interval);
      res.write('data: Done!\n\n');
      res.end();
    }
  }, 1000);
});


// Handle form submission
app.post('/process', upload.single('file'), async (req, res) => {
  const website = req.body.website; // Get the website URL from the form
  const csvFilePath = req.file.path; // Path to the uploaded CSV file

  if (!website || !csvFilePath) {
    return res.status(400).send('Invalid input.');
  }

  // Initialize an SSE connection
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  let progress = 0;
  const websiteFetchResult = await fetchHTML(website);
  const websiteHTML = websiteFetchResult.html;
  if (!websiteHTML) {
    return res.status(500).send(`Failed to fetch HTML from the given website. Error: ${websiteFetchResult.error}`);
  }

  // Extract clean text from the website's HTML
  const websiteContent = cheerio.load(websiteHTML).text().replace(/\s+/g, ' ').trim();

  const results = {
    similarBacklinks: [],
    failedBacklinks: [],
  };

  const backlinks = [];
  fs.createReadStream(csvFilePath)
    .pipe(csvParser())
    .on('data', (row) => {
      if (row.Site) {
        backlinks.push(row.Site);
      }
    })
    .on('end', async () => {
      const limit = pLimit(5); // Limit concurrent requests
      const tasks = backlinks.map((backlink, index) =>
        limit(async () => {
          const backlinkFetchResult = await fetchHTML(backlink);
          if (backlinkFetchResult.html) {
            const backlinkContent = cheerio
              .load(backlinkFetchResult.html)
              .text()
              .replace(/\s+/g, ' ')
              .trim();

            // Calculate similarity percentage
            const similarity = stringSimilarity.compareTwoStrings(websiteContent, backlinkContent) * 100;
            if (similarity > 50) {
              results.similarBacklinks.push({ url: backlink, similarity: similarity.toFixed(2) + '%' });
            }
          } else {
            results.failedBacklinks.push({
              url: backlink,
              error: backlinkFetchResult.error,
            });
          }

          // Update progress after processing each backlink
          progress = ((index + 1) / backlinks.length) * 100;
        })
      );

      await Promise.all(tasks);

      fs.unlinkSync(csvFilePath); // Remove the uploaded file
      res.json(results);
      res.end();
    })
    .on('error', (error) => {
      console.error('Error processing file:', error);
      res.status(500).send('Error processing the file.');
    });
});

// Start the server
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
