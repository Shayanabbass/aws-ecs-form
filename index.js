const cors = require('cors');

const express = require('express');
const mysql = require('mysql2/promise');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const Busboy = require('busboy');

const app = express();
const port = process.env.PORT || 3000;


const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.PASSWORD,
    database: process.env.DATABASE,
    connectTimeout: 5000,
});

const s3 = new S3Client({
    region: 'eu-north-1',
    requestHandler: new (require('@aws-sdk/node-http-handler').NodeHttpHandler)({
        connectionTimeout: 5000,
        socketTimeout: 5000,
    }),
});

// Middleware to handle CORS preflight
app.use(cors({
    origin: '*', // or your frontend URL
    methods: ['POST', 'OPTIONS'],
    allowedHeaders: '*',
}));

app.post('/upload', async (req, res) => {
    const contentType = req.headers['content-type'] || req.headers['Content-Type'];

    if (!contentType || !contentType.includes('multipart/form-data')) {
        return res.status(400).json({ error: `Unsupported content type: ${contentType}` });
    }

    const busboy = Busboy({ headers: req.headers });

    let name, email, message;
    let fileBuffer, fileName, mimeType;

    busboy.on('field', (fieldname, val) => {
        if (fieldname === 'name') name = val;
        if (fieldname === 'email') email = val;
        if (fieldname === 'message') message = val;
    });

    busboy.on('file', (fieldname, file, info) => {
        fileName = Date.now() + "-" + info.filename;
        mimeType = info.mimeType;

        const chunks = [];
        file.on('data', (data) => chunks.push(data));
        file.on('end', () => {
            fileBuffer = Buffer.concat(chunks);
        });
    });

    busboy.on('finish', async () => {
        try {
            let imageUrl = null;
            if (fileBuffer) {
                await s3.send(new PutObjectCommand({
                    Bucket: process.env.S3_BUCKET,
                    Key: fileName,
                    Body: fileBuffer,
                    ContentType: mimeType
                }));
                imageUrl = `https://${process.env.S3_BUCKET}.s3.amazonaws.com/${fileName}`;
            }

            await pool.execute(
                'INSERT INTO contacts (name, email, message, image_url) VALUES (?, ?, ?, ?)',
                [name, email, message, imageUrl]
            );

            res.json({ message: 'Form submitted successfully!' });
        } catch (err) {
            console.error(err);
            res.status(500).json({ message: 'Submission failed.', error: err.message });
        }
    });

    req.pipe(busboy);
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
