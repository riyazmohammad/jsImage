const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const OpenAI = require('openai');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const UPLOAD_FOLDER = 'uploads';

// Configure multer for file upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_FOLDER);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = uuidv4();
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_FOLDER)) {
  fs.mkdirSync(UPLOAD_FOLDER);
}

function deleteFileAfterDelay(filepath, delay = 60000) {
  setTimeout(() => {
    fs.unlink(filepath, (err) => {
      if (err) {
        console.error(`Error deleting file: ${filepath}`, err);
      } else {
        console.log(`Deleted file: ${filepath}`);
      }
    });
  }, delay);
}

async function convertImageToBase64(imageUrl) {
  try {
    let imageData;
    if (fs.existsSync(imageUrl)) {
      imageData = await fs.promises.readFile(imageUrl);
    } else {
      const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
      imageData = response.data;
    }
    return Buffer.from(imageData).toString('base64');
  } catch (error) {
    console.error('Error converting image to base64:', error);
    return null;
  }
}

app.post('/upload_image', upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No image file uploaded" });
  }

  const filepath = req.file.path;
  deleteFileAfterDelay(filepath);

  res.json({ file_path: filepath });
});

app.get('/uploads/:filename', (req, res) => {
  res.sendFile(path.join(__dirname, UPLOAD_FOLDER, req.params.filename));
});

app.post('/process_image', async (req, res) => {
  const { image_url } = req.body;

  if (!image_url) {
    return res.status(400).json({ error: "Image URL is required" });
  }

  const base64ImageString = await convertImageToBase64(image_url);
  if (!base64ImageString) {
    return res.status(500).json({ error: "Failed to fetch or encode the image" });
  }

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "order ID, order date (Using ISO 8601 format) , customer name, customer Phone Number, order item list with item name, quantity and price, subtotal amount, delivery fees, discount, total, i need these value in json format"
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${base64ImageString}`
              },
            },
          ],
        }
      ],
      max_tokens: 500,
    });

    const content = response.choices[0].message.content;
    const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/);
    
    if (jsonMatch) {
      const jsonContent = JSON.parse(jsonMatch[1]);
      console.log(jsonContent);
      res.json(jsonContent);
    } else {
      res.status(500).json({ error: "Failed to extract JSON from response" });
    }
  } catch (error) {
    console.error('Error processing image:', error);
    res.status(500).json({ error: "Error processing image" });
  }
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
