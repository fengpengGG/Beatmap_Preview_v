/**
 * osu! gameplay-style preview renderer — portrait layout.
 * Column widths auto-adapt for multi-key beatmaps.
 *
 * Exports:
 *   buildPianoLayout(canvasW, canvasH, colCount) → layout
 *   buildRenderColors(noteColors, lnColors, colCount) → colors
 *   renderGameplayFrame(canvas, bm, currentTimeMs, layout, colors, opts)
 */

// ── Layout constants ──
const PAST_BUFFER_RATIO = 0.2;
const HIT_FLASH_MS      = 140;

// ── Colors ──
const COL_BG_EVEN = 'rgba(33,33,54,0.62)';
const COL_BG_ODD  = 'rgba(25,25,42,0.62)';
const GRID_COLOR  = 'rgba(125,125,175,0.13)';
const RED_LINE    = '#dc3c3c';
const GREEN_LINE  = '#3cc83c';
const ACCENT_PINK = '#ff66aa';

const FALLBACK = '#c8c8eb';

// ═══════════════════════════════════════════════════════════════
//  预计算（歌曲加载时调用一次，不随帧变化）
// ═══════════════════════════════════════════════════════════════

export function buildPianoLayout(canvasW, canvasH, colCount) {
    // 所有尺寸按比例计算，让轨道铺满预览区域
    const sidePad    = Math.max(4, Math.round(canvasW * 0.03));
    const pianoMaxW  = canvasW - sidePad * 2;
    const gap        = Math.max(2, Math.round(pianoMaxW * 0.012));
    const colW       = Math.floor((pianoMaxW - (colCount - 1) * gap) / colCount);
    const pianoW     = colCount * colW + (colCount - 1) * gap;
    const pianoX     = Math.floor((canvasW - pianoW) / 2);
    const pianoTop   = Math.round(canvasH * 0.04);
    const judgeOff   = Math.max(20, Math.round(canvasH * 0.05));
    const pianoBottom = canvasH - judgeOff;
    const pianoH     = pianoBottom - pianoTop;
    const nw         = Math.max(4, Math.round(colW * 0.94));
    const topFadeH   = Math.round(pianoH * 0.04);
    const barW       = Math.floor(pianoW * 0.6);
    const barX       = Math.floor((canvasW - barW) / 2);
    const barY       = Math.round(canvasH - judgeOff * 0.6);

    return { canvasW, canvasH, pianoW, pianoH, pianoX, pianoTop, pianoBottom, colW, nw, gap, topFadeH, barW, barX, barY };
}

export function buildRenderColors(noteColors, lnColors, colCount) {
    const nc = (noteColors && noteColors.length > 0)
        ? padColors(noteColors, colCount) : padColors([FALLBACK], colCount);
    const lc = (lnColors && lnColors.length > 0)
        ? padColors(lnColors, colCount) : nc.map(h => darken(h, 0.7));
    return { noteCols: nc, lnCols: lc };
}

// ═══════════════════════════════════════════════════════════════

export function renderGameplayFrame(canvas, bm, currentTimeMs, layout, colors, opts = {}) {
    const {
        canvasW, canvasH, pianoW, pianoH,
        pianoX, pianoTop, pianoBottom, colW, nw, gap, topFadeH,
        barW, barX, barY,
    } = layout;
    const { noteCols, lnCols } = colors;

    const ctx = canvas.getContext('2d');
    const scale = pianoH / opts.visibleMs;

    const windowStart = currentTimeMs - opts.visibleMs * PAST_BUFFER_RATIO;
    const windowEnd   = currentTimeMs + opts.visibleMs;

    // ── Note 厚度 ──
    const isCircle  = opts.noteStyle === true;
    const useFx     = opts.noteEffects !== false;  // 默认开启特效
    const circleD   = Math.max(6, colW - 2);
    const noteH     = isCircle ? circleD : Math.max(4, opts.noteThickness > 0 ? opts.noteThickness : 20);

    // ── 精灵（离屏预渲染，缓存命中零开销） ──
    const noteSprites = isCircle
        ? noteCols.map(c => useFx ? getCircleNoteSprite(c, circleD) : getFlatCircleSprite(c, circleD))
        : noteCols.map(c => useFx ? getNoteSprite(c, nw, noteH) : getFlatNoteSprite(c, nw, noteH));
    const lnSprites = lnCols.map(c => useFx ? getLnSprite(c, nw) : getFlatLnSprite(c, nw));

    // ── 背景 ──
    const bgGrad = ctx.createLinearGradient(0, 0, 0, canvasH);
    bgGrad.addColorStop(0, '#171722');
    bgGrad.addColorStop(1, '#10101a');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, canvasW, canvasH);

    // ── 列背景 ──
    for (let ci = 0; ci < noteCols.length; ci++) {
        ctx.fillStyle = ci % 2 ? COL_BG_ODD : COL_BG_EVEN;
        ctx.fillRect(pianoX + ci * (colW + gap), pianoTop, colW, pianoH);
    }

    // ── 节拍网格 ──
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth   = 1;
    for (const [secS, secBl, secE] of bm._beatSectsCache) {
        if (secE <= windowStart || secS >= windowEnd) continue;
        const stop = Math.min(secE, windowEnd);
        for (let t = secS; t < stop; t += secBl) {
            if (t <= windowStart || t >= windowEnd) continue;
            const y = Math.round(pianoBottom - (t - currentTimeMs) * scale) + 0.5;
            if (y >= pianoTop && y <= pianoBottom) {
                ctx.beginPath();
                ctx.moveTo(pianoX, y);
                ctx.lineTo(pianoX + pianoW, y);
                ctx.stroke();
            }
        }
    }

    // ── TP 红绿线 ──
    for (const tp of bm.timingPoints) {
        if (tp.time < windowStart || tp.time > windowEnd) continue;
        const y = pianoBottom - (tp.time - currentTimeMs) * scale;
        if (y < pianoTop || y > pianoBottom) continue;

        const isRed = !tp.inherited;
        ctx.strokeStyle = isRed ? RED_LINE : GREEN_LINE;
        ctx.globalAlpha = 0.75;
        ctx.lineWidth   = 1.5;
        ctx.beginPath();
        ctx.moveTo(pianoX, Math.round(y));
        ctx.lineTo(pianoX + pianoW, Math.round(y));
        ctx.stroke();
        ctx.globalAlpha = 1;

        if (isRed && tp.beatLength > 0) {
            ctx.fillStyle = RED_LINE;
            ctx.font = '9px "Segoe UI", sans-serif';
            ctx.fillText(String(Math.round(60000 / tp.beatLength)), pianoX + 3, y - 3);
        }
    }

    // ═══════════════════════════════════════════════════════════
    // 音符 — 单次遍历分拣
    // ═══════════════════════════════════════════════════════════
    const colCount = noteCols.length;
    const lnBodies = [], heads = [], lnTails = [];
    const lastHit  = new Array(colCount).fill(-Infinity);
    const held     = new Array(colCount).fill(false);

    for (const obj of bm.hitObjects) {
        const isLn = obj.type & 128;
        const col  = obj.x * colCount / 512 | 0;
        if (col >= colCount) continue;

        if (obj.time <= currentTimeMs && obj.time > currentTimeMs - HIT_FLASH_MS) {
            if (obj.time > lastHit[col]) lastHit[col] = obj.time;
        }
        if (isLn && obj.endTime && obj.time <= currentTimeMs && obj.endTime > currentTimeMs) {
            held[col] = true;
        }

        // LN 身体：从当前时间到尾部，一直延伸到判定线
        if (isLn && obj.endTime && obj.endTime > currentTimeMs && obj.time < windowEnd) {
            const yT = Math.max(pianoTop, pianoBottom - (Math.min(obj.endTime, windowEnd) - currentTimeMs) * scale);
            const rawB = pianoBottom - (Math.max(obj.time, currentTimeMs) - currentTimeMs) * scale;
            const yB = Math.min(pianoBottom, rawB - (isCircle ? noteH / 2 : 0));
            if (yB > yT) lnBodies.push({ col, yT: Math.round(yT), yB: Math.round(yB) });
        }

        // LN 头部：若正在按住，固定在判定线位置；否则在判定线上方正常下落显示
        if (isLn && obj.endTime && obj.endTime > currentTimeMs) {
            if (obj.time <= currentTimeMs) {
                // 按住中，头部贴在判定线上
                heads.push({ col, y: pianoBottom });
            } else if (obj.time <= windowEnd) {
                const y = Math.round(pianoBottom - (obj.time - currentTimeMs) * scale);
                if (y >= pianoTop - noteH && y <= pianoBottom + noteH) {
                    heads.push({ col, y });
                }
            }
        }

        // 普通 note 头部
        if (!isLn && obj.time > currentTimeMs && obj.time <= windowEnd) {
            const y = Math.round(pianoBottom - (obj.time - currentTimeMs) * scale);
            if (y >= pianoTop - noteH && y <= pianoBottom + noteH) {
                heads.push({ col, y });
            }
        }

        // LN 尾部方块模式：尾部在视野内且未过判定线
        if (!isCircle && isLn && obj.endTime && obj.endTime > currentTimeMs && obj.endTime < windowEnd) {
            const y = Math.round(pianoBottom - (obj.endTime - currentTimeMs) * scale);
            if (y >= pianoTop && y <= pianoBottom) {
                lnTails.push({ col, y });
            }
        }
    }

    // LN 身体
    ctx.globalAlpha = 0.92;
    const cxBase = pianoX + 1;
    for (const { col, yT, yB } of lnBodies) {
        ctx.drawImage(lnSprites[col], cxBase + col * (colW + gap), yT, nw, yB - yT);
    }
    ctx.globalAlpha = 1;

    // 头部（始终底部对齐判定线）
    for (const { col, y } of heads) {
        ctx.drawImage(noteSprites[col], cxBase + col * (colW + gap), y - noteH);
    }

    // LN 尾标
    if (isCircle) {
        // 圆形模式：LN 尾部削成半圆
        for (const { col, yT } of lnBodies) {
            const cx = cxBase + col * (colW + gap);
            const r = nw / 2;
            ctx.fillStyle = lnCols[col];
            ctx.beginPath();
            ctx.arc(cx + r, yT, r, Math.PI, 0);  // 上半圆，平底在 yT，圆弧向上
            ctx.fill();
            ctx.strokeStyle = darken(lnCols[col], 0.55);
            ctx.lineWidth = 1;
            ctx.stroke();
        }
    } else {
        for (const { col, y } of lnTails) {
            const cx = cxBase + col * (colW + gap);
            rr(ctx, cx, y - 2, nw, 4, 2);
            ctx.fillStyle = noteCols[col];
            ctx.fill();
        }
    }

    // ── 顶部淡入遮罩 ──
    const fade = ctx.createLinearGradient(0, pianoTop, 0, pianoTop + topFadeH);
    fade.addColorStop(0, 'rgba(23,23,34,0.95)');
    fade.addColorStop(1, 'rgba(23,23,34,0)');
    ctx.fillStyle = fade;
    ctx.fillRect(pianoX, pianoTop, pianoW, topFadeH);

    // ── 判定线 ──
    if (opts.showJudgmentLine !== false) {
        ctx.fillStyle = 'rgba(255,255,255,0.14)';
        ctx.fillRect(pianoX, pianoBottom - 2, pianoW, 4);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(pianoX, pianoBottom - 1, pianoW, 2);
    }

    // ── 接收器 ──
    if (isCircle) {
        const recR = Math.max(4, circleD / 2);
        for (let ci = 0; ci < colCount; ci++) {
            const cx    = cxBase + ci * (colW + gap) + nw / 2;
            const cy    = pianoBottom - recR;
            const flash = Math.max(0, 1 - (currentTimeMs - lastHit[ci]) / HIT_FLASH_MS);

            ctx.beginPath();
            ctx.arc(cx, cy, recR - 0.5, 0, Math.PI * 2);
            if (held[ci] || flash > 0) {
                ctx.fillStyle = hexA(noteCols[ci], held[ci] ? 0.32 : 0.38 * flash);
                ctx.fill();
            }
            ctx.strokeStyle = flash > 0
                ? `rgba(255,255,255,${(0.35 + 0.65 * flash).toFixed(2)})`
                : 'rgba(255,255,255,0.22)';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }
    } else {
        const recH = Math.max(noteH + 6, 12);
        const recY = pianoBottom - recH;
        for (let ci = 0; ci < colCount; ci++) {
            const rx    = cxBase + ci * (colW + gap);
            const flash = Math.max(0, 1 - (currentTimeMs - lastHit[ci]) / HIT_FLASH_MS);

            rr(ctx, rx, recY, nw, recH, 4);
            if (held[ci] || flash > 0) {
                ctx.fillStyle = hexA(noteCols[ci], held[ci] ? 0.32 : 0.38 * flash);
                ctx.fill();
            }
            ctx.strokeStyle = flash > 0
                ? `rgba(255,255,255,${(0.35 + 0.65 * flash).toFixed(2)})`
                : 'rgba(255,255,255,0.22)';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }
    }

    // ── 进度条 ──
    const progressPct = Math.min(currentTimeMs / (bm.durationMs || 1), 1);

    ctx.fillStyle = '#8a8ab0';
    ctx.font = 'bold 10px "Segoe UI", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(formatTime(currentTimeMs / 1000), barX - 8, barY + 4);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#55556e';
    ctx.fillText(formatTime((bm.durationMs || 0) / 1000), barX + barW + 8, barY + 4);

    rr(ctx, barX, barY, barW, 4, 2);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fill();
    if (progressPct > 0) {
        rr(ctx, barX, barY, Math.max(4, barW * progressPct), 4, 2);
        ctx.fillStyle = ACCENT_PINK;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(barX + barW * progressPct, barY + 2, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
    }
}

// ═══════════════════════════════════════════════════════════════
//  精灵缓存
// ═══════════════════════════════════════════════════════════════

const spriteCache = new Map();

function getSprite(key, w, h, drawFn) {
    let s = spriteCache.get(key);
    if (!s) {
        if (spriteCache.size > 128) spriteCache.clear();
        s = document.createElement('canvas');
        s.width  = Math.max(1, Math.ceil(w));
        s.height = Math.max(1, Math.ceil(h));
        drawFn(s.getContext('2d'), s.width, s.height);
        spriteCache.set(key, s);
    }
    return s;
}

function getCircleNoteSprite(color, d) {
    return getSprite(`cn_${color}_${d}`, d, d, (c, w, h) => {
        const r = w / 2;
        const grad = c.createRadialGradient(w * 0.38, h * 0.35, 0, r, r, r);
        grad.addColorStop(0, lighten(color, 0.38));
        grad.addColorStop(0.55, color);
        grad.addColorStop(1, darken(color, 0.6));
        c.beginPath();
        c.arc(r, r, r - 0.5, 0, Math.PI * 2);
        c.fillStyle = grad;
        c.fill();
        c.strokeStyle = darken(color, 0.45);
        c.lineWidth = 1;
        c.stroke();
        // 高光
        c.beginPath();
        c.arc(r * 0.78, r * 0.72, r * 0.32, 0, Math.PI * 2);
        c.fillStyle = 'rgba(255,255,255,0.18)';
        c.fill();
    });
}

function getNoteSprite(color, w, h) {
    return getSprite(`n_${color}_${w}_${h}`, w, h, (c, w, h) => {
        const r = Math.min(4, h / 2, w / 2);
        const g = c.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, lighten(color, 0.25));
        g.addColorStop(0.45, color);
        g.addColorStop(1, darken(color, 0.72));
        rr(c, 0.5, 0.5, w - 1, h - 1, r);
        c.fillStyle = g;
        c.fill();
        c.strokeStyle = darken(color, 0.45);
        c.lineWidth = 1;
        c.stroke();
        rr(c, 2, 1.5, w - 4, Math.max(2, h * 0.35), Math.min(3, r));
        c.fillStyle = 'rgba(255,255,255,0.22)';
        c.fill();
    });
}

function getLnSprite(color, w) {
    return getSprite(`ln_${color}_${w}`, w, 24, (c, w, h) => {
        const g = c.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, lighten(color, 0.15));
        g.addColorStop(1, darken(color, 0.62));
        c.fillStyle = g;
        c.fillRect(0, 0, w, h);
        c.fillStyle = darken(color, 0.45);
        c.fillRect(0, 0, 1, h);
        c.fillRect(w - 1, 0, 1, h);
    });
}

// ── 无特效精灵（纯色，无高光/渐变） ──

function getFlatNoteSprite(color, w, h) {
    return getSprite(`fn_${color}_${w}_${h}`, w, h, (c, w, h) => {
        const r = Math.min(4, h / 2, w / 2);
        rr(c, 0.5, 0.5, w - 1, h - 1, r);
        c.fillStyle = color;
        c.fill();
        c.strokeStyle = darken(color, 0.6);
        c.lineWidth = 1;
        c.stroke();
    });
}

function getFlatCircleSprite(color, d) {
    return getSprite(`fcn_${color}_${d}`, d, d, (c, w, h) => {
        const r = w / 2;
        c.beginPath();
        c.arc(r, r, r - 0.5, 0, Math.PI * 2);
        c.fillStyle = color;
        c.fill();
        c.strokeStyle = darken(color, 0.6);
        c.lineWidth = 1;
        c.stroke();
    });
}

function getFlatLnSprite(color, w) {
    return getSprite(`fln_${color}_${w}`, w, 24, (c, w, h) => {
        c.fillStyle = color;
        c.fillRect(1, 0, w - 2, h);
        c.fillStyle = darken(color, 0.6);
        c.fillRect(0, 0, 1, h);
        c.fillRect(w - 1, 0, 1, h);
    });
}

// ═══════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════

function rr(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
}

function formatTime(sec) {
    const m = sec / 60 | 0;
    return `${m}:${String(sec % 60 | 0).padStart(2, '0')}`;
}

function hexToRgb(h) {
    const s = h.replace('#', '');
    return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

function hexA(hex, a) {
    const [r, g, b] = hexToRgb(hex);
    return `rgba(${r},${g},${b},${a})`;
}

function padColors(colors, count) {
    const out = colors.slice(0, count);
    while (out.length < count) out.push(colors[0] || FALLBACK);
    return out;
}

function darken(hex, factor) {
    if (!hex || hex[0] !== '#') return FALLBACK;
    return '#' + [0, 1, 2].map(i =>
        Math.max(0, Math.round(parseInt(hex.slice(i * 2 + 1, i * 2 + 3), 16) * factor))
            .toString(16).padStart(2, '0')
    ).join('');
}

function lighten(hex, p) {
    const [r, g, b] = hexToRgb(hex);
    const m = v => Math.round(v + (255 - v) * p);
    return `rgb(${m(r)},${m(g)},${m(b)})`;
}
