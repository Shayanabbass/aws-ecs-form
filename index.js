const mysql = require('mysql2/promise');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const Busboy = require('busboy');

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.PASSWORD,
    database: process.env.DATABASE,
    connectTimeout: 5000, // timeout for DB connections
});

const s3 = new S3Client({
    region: 'eu-north-1',
    requestHandler: new (require('@aws-sdk/node-http-handler').NodeHttpHandler)({
        connectionTimeout: 5000, // timeout for S3 requests
        socketTimeout: 5000,
    }),
});

exports.handler = async (event) => {
    console.log("Lambda invoked");

    if (event.requestContext?.http?.method === 'OPTIONS') {
        console.log("OPTIONS request, returning early");
        return {
            statusCode: 200,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST,OPTIONS",
                "Access-Control-Allow-Headers": "*",
            },
            body: ""
        };
    }

    return new Promise((resolve) => {

        const contentType =
            event.headers?.['content-type'] ||
            event.headers?.['Content-Type'];

        if (!contentType || !contentType.includes('multipart/form-data')) {
            console.log("Unsupported content type:", contentType);
            return resolve({
                statusCode: 400,
                headers: { "Access-Control-Allow-Origin": "*" },
                body: JSON.stringify({ error: `Unsupported content type: ${contentType}` })
            });
        }

        console.log("Parsing body...");
        const buffer = event.isBase64Encoded
            ? Buffer.from(event.body, 'base64')
            : Buffer.from(event.body);

        const busboy = Busboy({ headers: { 'content-type': contentType } });

        let name, email, message;
        let fileBuffer;
        let fileName;
        let mimeType;

        busboy.on('field', (fieldname, val) => {
            console.log(`Field received: ${fieldname} = ${val}`);
            if (fieldname === 'name') name = val;
            if (fieldname === 'email') email = val;
            if (fieldname === 'message') message = val;
        });

        busboy.on('file', (fieldname, file, info) => {
            console.log(`File received: ${info.filename}, type: ${info.mimeType}`);
            fileName = Date.now() + "-" + info.filename;
            mimeType = info.mimeType;

            const chunks = [];
            file.on('data', (data) => {
                console.log(`Receiving file chunk of size: ${data.length}`);
                chunks.push(data);
            });

            file.on('end', () => {
                console.log("File upload finished in buffer");
                fileBuffer = Buffer.concat(chunks);
                console.log("Total file size in buffer:", fileBuffer.length);
            });
        });

        busboy.on('finish', async () => {
            console.log("Busboy finished parsing form");

            try {
                if (!fileBuffer) {
                    console.log("No fileBuffer found, skipping S3 upload");
                } else {
                    console.log("Uploading file to S3...");
                    const start = Date.now();
                    await s3.send(new PutObjectCommand({
                        Bucket: process.env.S3_BUCKET,
                        Key: fileName,
                        Body: fileBuffer,
                        ContentType: mimeType
                    }));
                    console.log(`File uploaded to S3 successfully in ${Date.now() - start} ms`);
                }

                const imageUrl = fileBuffer ? `https://${process.env.S3_BUCKET}.s3.amazonaws.com/${fileName}` : null;

                console.log("Connecting to MySQL...");
                const dbStart = Date.now();
                await pool.execute(
                    'INSERT INTO contacts (name, email, message, image_url) VALUES (?, ?, ?, ?)',
                    [name, email, message, imageUrl]
                );
                console.log(`Database insert successful in ${Date.now() - dbStart} ms`);

                resolve({
                    statusCode: 200,
                    headers: {
                        "Access-Control-Allow-Origin": "*",
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({ message: 'Form submitted successfully!' })
                });

            } catch (err) {
                console.error("Error in finish handler:", err);

                // Check if it is a network timeout
                if (err.code === 'TimeoutError') {
                    console.error("Network timeout detected. Check VPC, SG, or S3 endpoint settings.");
                }

                resolve({
                    statusCode: 500,
                    headers: {
                        "Access-Control-Allow-Origin": "*",
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({ message: 'Submission failed.', error: err.message })
                });
            }
        });

        busboy.end(buffer);
    });
};
