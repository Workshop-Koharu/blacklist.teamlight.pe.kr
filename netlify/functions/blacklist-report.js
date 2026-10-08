/**
 * Netlify Function: blacklist-report
 *
 * 遊??쒕쾭(?ы듃 3001)瑜?嫄곗튂吏 ?딄퀬 Discord REST API瑜?吏곸젒 ?몄텧?⑸땲??
 * 梨꾨꼸 ?앹꽦, ?꾨쿋???꾩넚, ?뚯씪 泥⑤?瑜?紐⑤몢 ???⑥닔?먯꽌 泥섎━?⑸땲??
 *
 * ?꾩닔 Netlify ?섍꼍蹂?? DISCORD_BOT_TOKEN
 */

'use strict';

const crypto = require('crypto');

const DISCORD_API    = 'https://discord.com/api/v10';
const SUPPORT_GUILD  = '1363130395172016180';
const BOT_USER_ID    = '1395960857250365512';

// ?? Discord permission bits (BigInt) ??????????????????????????????????????
const P_VIEW    = 1024n;
const P_SEND    = 2048n;
const P_HIST    = 65536n;
const P_ATTACH  = 32768n;
const P_MANAGE_MSG = 8192n;
const P_MANAGE_CH  = 16n;

// ?? Helpers ???????????????????????????????????????????????????????????????

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin' : 'https://blacklist.teamlight.pe.kr',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json',
    };
}

function jsonResp(statusCode, body) {
    return { statusCode, headers: corsHeaders(), body: JSON.stringify(body) };
}

function generateTicketId() {
    return crypto.randomBytes(4).toString('hex').toUpperCase();
}

function sanitizeChannelName(name) {
    return String(name).toLowerCase()
        .replace(/[^a-z0-9媛-?ｃ꽦-?롢뀖-??-_]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .substring(0, 28) || 'ticket';
}

async function discordFetch(path, options = {}) {
    const token = process.env.DISCORD_BOT_TOKEN;
    if (!token) throw new Error('DISCORD_BOT_TOKEN ?섍꼍蹂?섍? Netlify???ㅼ젙?섏? ?딆븯?듬땲??');

    const res = await fetch(`${DISCORD_API}${path}`, {
        ...options,
        headers: {
            Authorization: `Bot ${token}`,
            ...(options.headers || {}),
        },
    });

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!res.ok) {
        throw new Error(`Discord API ${res.status}: ${JSON.stringify(data).substring(0, 400)}`);
    }
    return data;
}

/** multipart/form-data 諛붾뵒瑜?Buffer濡?吏곸젒 議곕┰?⑸땲??*/
function buildMultipart(payloadJson, files) {
    const boundary = 'bl' + crypto.randomBytes(12).toString('hex');
    const parts    = [];

    // payload_json ?뚰듃
    parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="payload_json"\r\n` +
        `Content-Type: application/json\r\n\r\n${JSON.stringify(payloadJson)}\r\n`
    ));

    // ?뚯씪 ?뚰듃
    files.forEach((file, i) => {
        const ext  = (file.name || 'evidence.png').split('.').pop() || 'png';
        const fname = `evidence_${i + 1}.${ext}`;
        const ct   = file.type || 'image/png';
        parts.push(Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="files[${i}]"; filename="${fname}"\r\n` +
            `Content-Type: ${ct}\r\n\r\n`
        ));
        parts.push(Buffer.from(file.data, 'base64'));
        parts.push(Buffer.from('\r\n'));
    });

    parts.push(Buffer.from(`--${boundary}--\r\n`));

    return {
        body       : Buffer.concat(parts),
        contentType: `multipart/form-data; boundary=${boundary}`,
    };
}

// ?? Main handler ??????????????????????????????????????????????????????????

exports.handler = async function (event) {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders(), body: '' };
    if (event.httpMethod !== 'POST')    return jsonResp(405, { message: '?덉슜?섏? ?딅뒗 硫붿꽌?쒖엯?덈떎.' });

    // ?? 1. Body ?뚯떛 ??????????????????????????????????????????????????????
    let body;
    try {
        const raw = event.isBase64Encoded
            ? Buffer.from(event.body, 'base64').toString('utf-8')
            : (event.body || '');
        body = JSON.parse(raw);
    } catch {
        return jsonResp(400, { message: '?섎せ??JSON ?뺤떇?낅땲??' });
    }

    const {
        reporterId, reporterName,
        reportedUserId, offenderNickname,
        reportReason, description,
        files = [],
    } = body;

    // ?? 2. ?좏슚??寃??????????????????????????????????????????????????????
    if (!reporterId || !reporterName || !reportedUserId || !offenderNickname || !reportReason || !description)
        return jsonResp(400, { message: '?꾩닔 ?꾨뱶媛 ?꾨씫?섏뿀?듬땲??' });
    if (!/^\d{17,20}$/.test(String(reporterId)))
        return jsonResp(400, { message: '?좏슚?섏? ?딆? ?좉퀬??ID?낅땲??' });
    if (!/^\d{17,20}$/.test(String(reportedUserId)))
        return jsonResp(400, { message: '?좏슚?섏? ?딆? ?좉퀬 ????좎? ID?낅땲??' });
    if (String(description).length < 10)
        return jsonResp(400, { message: '?곸꽭 ?ㅻ챸? 10???댁긽 ?묒꽦?댁＜?몄슂.' });

    // ?? 3. 梨꾨꼸 ?앹꽦 ??????????????????????????????????????????????????????
    try {
        const ticketId    = generateTicketId();
        const channelName = `${sanitizeChannelName(reporterName)}-${ticketId.toLowerCase()}`;

        const reporterAllow = String(P_VIEW | P_SEND | P_HIST | P_ATTACH);
        const botAllow      = String(P_VIEW | P_SEND | P_HIST | P_ATTACH | P_MANAGE_MSG | P_MANAGE_CH);
        const everyoneDeny  = String(P_VIEW);

        const channel = await discordFetch(`/guilds/${SUPPORT_GUILD}/channels`, {
            method : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body   : JSON.stringify({
                name : channelName,
                type : 0,
                topic: `釉붾옓由ъ뒪???좉퀬 | ?곗폆: #${ticketId} | ?좉퀬?? ${reporterName} (${reporterId})`,
                permission_overwrites: [
                    { id: SUPPORT_GUILD, type: 0, deny: everyoneDeny,  allow: '0' },
                    { id: reporterId,    type: 1, allow: reporterAllow, deny: '0' },
                    { id: BOT_USER_ID,   type: 1, allow: botAllow,      deny: '0' },
                ],
            }),
        });

        // ?? 4. ?꾨쿋??鍮뚮뱶 ????????????????????????????????????????????????
        const now = new Date().toISOString();
        const mainEmbed = {
            title    : `?슚 釉붾옓由ъ뒪???좉퀬 ?묒닔 ???곗폆 #${ticketId}`,
            color    : 0xC026D3,
            timestamp: now,
            fields   : [
                { name: '?뱦 ?좉퀬 ???,    value: `<@${reportedUserId}>\n\`${reportedUserId}\``, inline: true  },
                { name: '?뤇截?媛?댁옄 ?됰꽕??, value: `\`${offenderNickname}\``,                   inline: true  },
                { name: '\u200b',           value: '\u200b',                                    inline: true  },
                { name: '?뫀 ?좉퀬???좎?',   value: `<@${reporterId}>\n\`${reporterId}\``,        inline: true  },
                { name: '?뱥 ?좉퀬???됰꽕??, value: `\`${reporterName}\``,                        inline: true  },
                { name: '\u200b',           value: '\u200b',                                    inline: true  },
                { name: '?좑툘 ?좉퀬 ?ъ쑀',    value: `\`${reportReason}\``,                        inline: false },
                { name: '?뱷 ?곸꽭 ?ㅻ챸',    value: String(description).substring(0, 1024),       inline: false },
            ],
            footer: { text: `?곗폆 踰덊샇: ${ticketId} 쨌 ?좉퀬 ?묒닔` },
        };

        const guideEmbed = {
            color      : 0x7C3AED,
            description:
                '> **愿由ъ옄 ?꾩슜 紐낅졊??*\n> \n' +
                '> ?뵶 湲곌컖: `?쒕┛??湲곌컖`\n' +
                '> ?윟 ?뱀씤: `?쒕┛???뱀씤 [?ъ쑀]`\n> \n' +
                '> ?좑툘 ??紐낅졊?대뒗 ???쒕쾭??愿由ъ옄 沅뚰븳??媛吏?遺꾨쭔 ?ъ슜?????덉뒿?덈떎.\n' +
                '> ?뱀씤 ??釉붾옓由ъ뒪??梨꾨꼸???먮룞?쇰줈 ?깆옱?⑸땲??',
        };

        // ?? 5. 硫붿떆吏 + ?뚯씪 ?꾩넚 ?????????????????????????????????????????
        const validFiles = Array.isArray(files)
            ? files.filter(f => f && f.data).slice(0, 10)
            : [];

        if (validFiles.length > 0) {
            const { body: mpBody, contentType } = buildMultipart(
                { embeds: [mainEmbed, guideEmbed] },
                validFiles,
            );
            await discordFetch(`/channels/${channel.id}/messages`, {
                method : 'POST',
                headers: { 'Content-Type': contentType },
                body   : mpBody,
            });
        } else {
            await discordFetch(`/channels/${channel.id}/messages`, {
                method : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body   : JSON.stringify({ embeds: [mainEmbed, guideEmbed] }),
            });
        }

        // ?? 6. 硫섏뀡 硫붿떆吏 ????????????????????????????????????????????????
        await discordFetch(`/channels/${channel.id}/messages`, {
            method : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body   : JSON.stringify({
                content: `<@${reporterId}> ?좉퀬媛 ?묒닔?섏뿀?듬땲?? ?대떦 愿由ъ옄 寃????寃곌낵瑜??덈궡???쒕┰?덈떎.`,
            }),
        });

        return jsonResp(200, {
            ok       : true,
            ticketId,
            channelId: String(channel.id),
            message  : '?좉퀬媛 ?묒닔?섏뿀?듬땲??',
        });

    } catch (err) {
        console.error('[Blacklist]', err.message);

        const isAuth = /401|403/.test(err.message);
        return jsonResp(isAuth ? 403 : 500, {
            message: isAuth
                ? 'Discord 遊??좏겙???좏슚?섏? ?딆뒿?덈떎. Netlify ?섍꼍蹂??DISCORD_BOT_TOKEN???뺤씤?댁＜?몄슂.'
                : `?좉퀬 泥섎━ ?ㅻ쪟: ${err.message}`,
        });
    }
};

