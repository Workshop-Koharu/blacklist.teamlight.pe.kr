/**
 * Netlify Function: blacklist-report
 *
 * 봇 서버(포트 3001)를 거치지 않고 Discord REST API를 직접 호출합니다.
 * 채널 생성, 임베드 전송, 파일 첨부를 모두 이 함수에서 처리합니다.
 *
 * 필수 Netlify 환경변수: DISCORD_BOT_TOKEN
 */

'use strict';

const crypto = require('crypto');

const DISCORD_API    = 'https://discord.com/api/v10';
const SUPPORT_GUILD  = '1363130395172016180';
const BOT_USER_ID    = '1395960857250365512';

// ── Discord permission bits (BigInt) ──────────────────────────────────────
const P_VIEW    = 1024n;
const P_SEND    = 2048n;
const P_HIST    = 65536n;
const P_ATTACH  = 32768n;
const P_MANAGE_MSG = 8192n;
const P_MANAGE_CH  = 16n;

// ── Helpers ───────────────────────────────────────────────────────────────

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
        .replace(/[^a-z0-9가-힣ㄱ-ㅎㅏ-ㅣ\-_]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .substring(0, 28) || 'ticket';
}

async function discordFetch(path, options = {}) {
    const token = process.env.DISCORD_BOT_TOKEN;
    if (!token) throw new Error('DISCORD_BOT_TOKEN 환경변수가 Netlify에 설정되지 않았습니다.');

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

/** multipart/form-data 바디를 Buffer로 직접 조립합니다 */
function buildMultipart(payloadJson, files) {
    const boundary = 'bl' + crypto.randomBytes(12).toString('hex');
    const parts    = [];

    // payload_json 파트
    parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="payload_json"\r\n` +
        `Content-Type: application/json\r\n\r\n${JSON.stringify(payloadJson)}\r\n`
    ));

    // 파일 파트
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

// ── Main handler ──────────────────────────────────────────────────────────

exports.handler = async function (event) {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders(), body: '' };
    if (event.httpMethod !== 'POST')    return jsonResp(405, { message: '허용되지 않는 메서드입니다.' });

    // ── 1. Body 파싱 ──────────────────────────────────────────────────────
    let body;
    try {
        const raw = event.isBase64Encoded
            ? Buffer.from(event.body, 'base64').toString('utf-8')
            : (event.body || '');
        body = JSON.parse(raw);
    } catch {
        return jsonResp(400, { message: '잘못된 JSON 형식입니다.' });
    }

    const {
        reporterId, reporterName,
        reportedUserId, offenderNickname,
        reportReason, description,
        files = [],
    } = body;

    // ── 2. 유효성 검사 ────────────────────────────────────────────────────
    if (!reporterId || !reporterName || !reportedUserId || !offenderNickname || !reportReason || !description)
        return jsonResp(400, { message: '필수 필드가 누락되었습니다.' });
    if (!/^\d{17,20}$/.test(String(reporterId)))
        return jsonResp(400, { message: '유효하지 않은 신고자 ID입니다.' });
    if (!/^\d{17,20}$/.test(String(reportedUserId)))
        return jsonResp(400, { message: '유효하지 않은 신고 대상 유저 ID입니다.' });
    if (String(description).length < 10)
        return jsonResp(400, { message: '상세 설명은 10자 이상 작성해주세요.' });

    // ── 3. 채널 생성 ──────────────────────────────────────────────────────
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
                topic: `블랙리스트 신고 | 티켓: #${ticketId} | 신고자: ${reporterName} (${reporterId})`,
                permission_overwrites: [
                    { id: SUPPORT_GUILD, type: 0, deny: everyoneDeny,  allow: '0' },
                    { id: reporterId,    type: 1, allow: reporterAllow, deny: '0' },
                    { id: BOT_USER_ID,   type: 1, allow: botAllow,      deny: '0' },
                ],
            }),
        });

        // ── 4. 임베드 빌드 ────────────────────────────────────────────────
        const now = new Date().toISOString();
        const mainEmbed = {
            title    : `🚨 블랙리스트 신고 접수 — 티켓 #${ticketId}`,
            color    : 0xC026D3,
            timestamp: now,
            fields   : [
                { name: '📌 신고 대상',    value: `<@${reportedUserId}>\n\`${reportedUserId}\``, inline: true  },
                { name: '🏷️ 가해자 닉네임', value: `\`${offenderNickname}\``,                   inline: true  },
                { name: '\u200b',           value: '\u200b',                                    inline: true  },
                { name: '👤 신고한 유저',   value: `<@${reporterId}>\n\`${reporterId}\``,        inline: true  },
                { name: '📋 신고자 닉네임', value: `\`${reporterName}\``,                        inline: true  },
                { name: '\u200b',           value: '\u200b',                                    inline: true  },
                { name: '⚠️ 신고 사유',    value: `\`${reportReason}\``,                        inline: false },
                { name: '📝 상세 설명',    value: String(description).substring(0, 1024),       inline: false },
            ],
            footer: { text: `티켓 번호: ${ticketId} · 신고 접수` },
        };

        const guideEmbed = {
            color      : 0x7C3AED,
            description:
                '> **관리자 전용 명령어**\n> \n' +
                '> 🔴 기각: `서린아 기각`\n' +
                '> 🟢 승인: `서린아 승인 [사유]`\n> \n' +
                '> ⚠️ 위 명령어는 이 서버의 관리자 권한을 가진 분만 사용할 수 있습니다.\n' +
                '> 승인 시 블랙리스트 채널에 자동으로 등재됩니다.',
        };

        // ── 5. 메시지 + 파일 전송 ─────────────────────────────────────────
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

        // ── 6. 멘션 메시지 ────────────────────────────────────────────────
        await discordFetch(`/channels/${channel.id}/messages`, {
            method : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body   : JSON.stringify({
                content: `<@${reporterId}> 신고가 접수되었습니다. 담당 관리자 검토 후 결과를 안내해 드립니다.`,
            }),
        });

        return jsonResp(200, {
            ok       : true,
            ticketId,
            channelId: String(channel.id),
            message  : '신고가 접수되었습니다.',
        });

    } catch (err) {
        console.error('[Blacklist]', err.message);

        const isAuth = /401|403/.test(err.message);
        return jsonResp(isAuth ? 403 : 500, {
            message: isAuth
                ? 'Discord 봇 토큰이 유효하지 않습니다. Netlify 환경변수 DISCORD_BOT_TOKEN을 확인해주세요.'
                : `신고 처리 오류: ${err.message}`,
        });
    }
};
