'use strict';

const netlifyHandler = require('../netlify/functions/blacklist-report').handler;

module.exports = async function handler(req, res) {
    const chunks = [];
    try {
        if (req.body !== undefined) {
            chunks.push(Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body)));
        } else {
            for await (const chunk of req) chunks.push(Buffer.from(chunk));
        }

        const event = {
            httpMethod: req.method,
            headers: req.headers || {},
            body: Buffer.concat(chunks).toString('utf8'),
            isBase64Encoded: false,
        };

        const result = await netlifyHandler(event);
        for (const [name, value] of Object.entries(result.headers || {})) {
            res.setHeader(name, value);
        }
        res.status(result.statusCode || 200);
        return res.send(result.body || '');
    } catch (error) {
        console.error('[Vercel API adapter]', error);
        return res.status(500).json({ message: '서버 내부 오류가 발생했습니다.' });
    }
};
