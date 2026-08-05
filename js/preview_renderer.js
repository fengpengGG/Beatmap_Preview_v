/**
 * osu! gameplay-style preview renderer — portrait layout.
 * Column widths auto-adapt for multi-key beatmaps.
 *
 * Exports:
 *   buildPianoLayout(canvasW, canvasH, colCount, densityW) → layout
 *   buildRenderColors(noteColors, lnColors, colCount) → colors
 *   buildHitIndex(hitObjects) → { starts, ends, lnEnds }
 *   buildDensityMap(hitObjects, durationMs, numBars) → density cache
 *   renderGameplayFrame(canvas, bm, currentTimeMs, layout, colors, opts)
 */

// ── Layout constants ──
const PAST_BUFFER_RATIO = 0.2;
const HIT_FLASH_MS      = 140;

// ── Density map ──
const DENSITY_BG          = 'rgba(18,18,30,0.82)';
const DENSITY_NORMAL      = '#42A5F5';  // 默认正常密度颜色（蓝）
const DENSITY_HOT         = '#FF69B4';  // 默认达到显示上限的颜色（粉）
const DENSITY_CURSOR      = '#ffffff';

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

export function buildPianoLayout(canvasW, canvasH, colCount, densityW = 0) {
    // 所有尺寸按比例计算，让轨道铺满预览区域
    const sidePad    = Math.max(4, Math.round(canvasW * 0.03));
    // 开启密度图时，轨道整体右移让出左侧密度条区域
    const leftPad    = sidePad + densityW + (densityW > 0 ? 5 : 0);
    const pianoMaxW  = canvasW - leftPad - sidePad;
    const gap        = Math.max(2, Math.round(pianoMaxW * 0.012));
    const colW       = Math.floor((pianoMaxW - (colCount - 1) * gap) / colCount);
    const pianoW     = colCount * colW + (colCount - 1) * gap;
    const pianoX     = leftPad + Math.floor((pianoMaxW - pianoW) / 2);
    const pianoTop   = Math.round(canvasH * 0.04);
    const judgeOff   = Math.max(20, Math.round(canvasH * 0.05));
    const pianoBottom = canvasH - judgeOff;
    const pianoH     = pianoBottom - pianoTop;
    const nw         = Math.max(4, Math.round(colW * 0.94));
    const topFadeH   = Math.round(pianoH * 0.04);
    const barW       = Math.floor(pianoW * 0.6);
    const barX       = Math.floor((canvasW - barW) / 2);
    const barY       = Math.round(canvasH - judgeOff * 0.6);

    // 密度图区域（画布左缘，与钢琴同高）
    const densityX = densityW > 0 ? 0 : -1;
    const densityTop = pianoTop;
    const densityH = pianoH;

    return { canvasW, canvasH, pianoW, pianoH, pianoX, pianoTop, pianoBottom, colW, nw, gap, topFadeH, barW, barX, barY, densityX, densityW, densityTop, densityH };
}

export function buildRenderColors(noteColors, lnColors, colCount) {
    const nc = (noteColors && noteColors.length > 0)
        ? padColors(noteColors, colCount) : padColors([FALLBACK], colCount);
    const lc = (lnColors && lnColors.length > 0)
        ? padColors(lnColors, colCount) : nc.map(h => darken(h, 0.7));
    return { noteCols: nc, lnCols: lc };
}

/**
 * 预建音符时间索引：{ starts, ends, lnEnds }
 * 每个数组按时间升序排列，用于二分查找定位窗口范围。
 */
export function buildHitIndex(hitObjects) {
    const starts = [], ends = [], lnEnds = [];
    for (let i = 0; i < hitObjects.length; i++) {
        const o = hitObjects[i];
        starts.push({ t: o.time, x: o.x, type: o.type, endTime: o.endTime, idx: i });
        if (o.type & 128 && o.endTime) {
            ends.push(o.endTime);
            lnEnds.push({ t: o.time, end: o.endTime, x: o.x, idx: i });
        }
    }
    starts.sort((a, b) => a.t - b.t);
    ends.sort((a, b) => a - b);
    lnEnds.sort((a, b) => a.t - b.t);
    return { starts, ends, lnEnds };
}

/** 二分查找：返回首个 >= t 的索引 */
function bisectLeft(arr, t, key) {
    let lo = 0, hi = arr.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if ((key ? arr[mid][key] : arr[mid]) < t) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

/**
 * 密度图预计算：将歌曲均分为 numBars 个等宽柱形（柱宽固定，不随歌长自适应）。
 * 长按音符只统计开始时间（与 osu 编辑器密度统计一致，每 note 记一次）。
 * 高度基准 maxCount = 全谱面最高窗口计数，柱高 = count/maxCount * 可用高度。
 * 返回 { counts, maxCount, numBars, durationMs }
 */
export function buildDensityMap(hitObjects, durationMs, numBars) {
    if (!hitObjects.length || durationMs <= 0) return null;
    const nb = Math.max(1, numBars | 0);
    const counts = new Array(nb).fill(0);
    const span = durationMs / nb;  // 每个柱形代表的时间跨度
    for (let i = 0; i < hitObjects.length; i++) {
        const idx = Math.min(nb - 1, Math.max(0, (hitObjects[i].time / span) | 0));
        counts[idx]++;
    }
    let maxCount = 0;
    for (const c of counts) { if (c > maxCount) maxCount = c; }
    return { counts, maxCount, numBars: nb, durationMs };
}

// ═══════════════════════════════════════════════════════════════

export function renderGameplayFrame(canvas, bm, currentTimeMs, layout, colors, opts = {}) {
    const {
        canvasW, canvasH, pianoW, pianoH,
        pianoX, pianoTop, pianoBottom, colW, nw, gap, topFadeH,
        barW, barX, barY,
        densityX, densityW, densityTop, densityH,
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
        ? noteCols.map(c => getCircleNoteSprite(c, circleD, !useFx))
        : noteCols.map(c => getNoteSprite(c, nw, noteH, !useFx));
    const lnSprites = lnCols.map(c => getLnSprite(c, nw, !useFx));

    // ── 背景 ──
    const bgGrad = ctx.createLinearGradient(0, 0, 0, canvasH);
    bgGrad.addColorStop(0, '#171722');
    bgGrad.addColorStop(1, '#10101a');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, canvasW, canvasH);

    // ── 密度图（轨道左侧） ──
    if (densityW > 0) {
        drawDensityMap(ctx, bm, currentTimeMs,
            densityX, densityTop, densityW, densityH,
            opts.densityStyle, opts.densityColor, opts.densityHotColor,
            opts.densityFillLine, opts.densityFillAlpha);
    }

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
    const tps = bm.timingPoints;
    const tpStart = bisectLeft(tps, windowStart, 'time');
    const tpEnd   = bisectLeft(tps, windowEnd, 'time');
    for (let ti = tpStart; ti < tpEnd; ti++) {
        const tp = tps[ti];
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
    // 音符 — 基于预建索引的窗口遍历
    // ═══════════════════════════════════════════════════════════
    const colCount = noteCols.length;
    const lnBodies = [], heads = [], lnTails = [];
    const lastHit  = new Array(colCount).fill(-Infinity);
    const held     = new Array(colCount).fill(false);

    const hitIdx = bm._hitIndex;
    const objs   = bm.hitObjects;
    const si     = bisectLeft(hitIdx.starts, windowStart, 't');
    const ei     = bisectLeft(hitIdx.starts, windowEnd, 't');

    // ── 主遍历：窗口内的下落音符 ──
    for (let i = si; i < ei; i++) {
        const obj = objs[hitIdx.starts[i].idx];
        const isLn = obj.type & 128;
        const col  = obj.x * colCount / 512 | 0;
        if (col >= colCount) continue;

        if (obj.time <= currentTimeMs && obj.time > currentTimeMs - HIT_FLASH_MS) {
            if (obj.time > lastHit[col]) lastHit[col] = obj.time;
        }

        // LN 身体（仅下落阶段，已按住的由 held pass 处理）
        if (isLn && obj.endTime && obj.time > currentTimeMs && obj.endTime > currentTimeMs) {
            const yT = Math.round(Math.max(pianoTop, pianoBottom - (Math.min(obj.endTime, windowEnd) - currentTimeMs) * scale));
            const rawB = pianoBottom - (obj.time - currentTimeMs) * scale;
            const yB = Math.min(pianoBottom, rawB - (isCircle ? noteH / 2 : 0));
            if (yB > yT) lnBodies.push({ col, yT, yB });
        }

        // LN 下落头部
        if (isLn && obj.endTime && obj.time > currentTimeMs && obj.endTime > currentTimeMs) {
            const y = Math.round(pianoBottom - (obj.time - currentTimeMs) * scale);
            if (y >= pianoTop - noteH && y <= pianoBottom + noteH) {
                heads.push({ col, y });
            }
        }

        // 普通 note 头部（未过判定线才显示）
        if (!isLn && obj.time > currentTimeMs) {
            const y = Math.round(pianoBottom - (obj.time - currentTimeMs) * scale);
            if (y >= pianoTop - noteH && y <= pianoBottom + noteH) {
                heads.push({ col, y });
            }
        }

        // LN 尾部方块模式
        if (!isCircle && isLn && obj.endTime && obj.endTime > currentTimeMs && obj.endTime < windowEnd) {
            const y = Math.round(pianoBottom - (obj.endTime - currentTimeMs) * scale);
            if (y >= pianoTop && y <= pianoBottom) {
                lnTails.push({ col, y });
            }
        }
    }

    // ── 已按住的长条（开始时间 < windowStart，但仍需显示身体和头部） ──
    for (const ln of hitIdx.lnEnds) {
        if (ln.t > currentTimeMs) break;
        if (ln.end <= currentTimeMs) continue;
        const obj = objs[ln.idx];
        const col = obj.x * colCount / 512 | 0;
        if (col >= colCount) continue;

        held[col] = true;

        const yT = Math.round(Math.max(pianoTop, pianoBottom - (Math.min(obj.endTime, windowEnd) - currentTimeMs) * scale));
        const yB = Math.min(pianoBottom, pianoBottom - (isCircle ? noteH / 2 : 0));
        if (yB > yT) lnBodies.push({ col, yT, yB });

        heads.push({ col, y: pianoBottom });
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

function getCircleNoteSprite(color, d, flat) {
    const pf = flat ? 'fcn_' : 'cn_';
    return getSprite(`${pf}${color}_${d}`, d, d, (c, w, h) => {
        const r = w / 2;
        c.beginPath();
        c.arc(r, r, r - 0.5, 0, Math.PI * 2);
        if (flat) {
            c.fillStyle = color;
        } else {
            const grad = c.createRadialGradient(w * 0.38, h * 0.35, 0, r, r, r);
            grad.addColorStop(0, lighten(color, 0.38));
            grad.addColorStop(0.55, color);
            grad.addColorStop(1, darken(color, 0.6));
            c.fillStyle = grad;
        }
        c.fill();
        c.strokeStyle = darken(color, flat ? 0.6 : 0.45);
        c.lineWidth = 1;
        c.stroke();
        if (!flat) {
            c.beginPath();
            c.arc(r * 0.78, r * 0.72, r * 0.32, 0, Math.PI * 2);
            c.fillStyle = 'rgba(255,255,255,0.18)';
            c.fill();
        }
    });
}

function getNoteSprite(color, w, h, flat) {
    const pf = flat ? 'fn_' : 'n_';
    return getSprite(`${pf}${color}_${w}_${h}`, w, h, (c, w, h) => {
        const r = Math.min(4, h / 2, w / 2);
        rr(c, 0.5, 0.5, w - 1, h - 1, r);
        if (flat) {
            c.fillStyle = color;
        } else {
            const g = c.createLinearGradient(0, 0, 0, h);
            g.addColorStop(0, lighten(color, 0.25));
            g.addColorStop(0.45, color);
            g.addColorStop(1, darken(color, 0.72));
            c.fillStyle = g;
        }
        c.fill();
        c.strokeStyle = darken(color, flat ? 0.6 : 0.45);
        c.lineWidth = 1;
        c.stroke();
        if (!flat) {
            rr(c, 2, 1.5, w - 4, Math.max(2, h * 0.35), Math.min(3, r));
            c.fillStyle = 'rgba(255,255,255,0.22)';
            c.fill();
        }
    });
}

function getLnSprite(color, w, flat) {
    const pf = flat ? 'fln_' : 'ln_';
    return getSprite(`${pf}${color}_${w}`, w, 24, (c, w, h) => {
        if (flat) {
            c.fillStyle = color;
        } else {
            const g = c.createLinearGradient(0, 0, 0, h);
            g.addColorStop(0, lighten(color, 0.15));
            g.addColorStop(1, darken(color, 0.62));
            c.fillStyle = g;
        }
        c.fillRect(1, 0, w - 2, h);
        c.fillStyle = darken(color, flat ? 0.6 : 0.45);
        c.fillRect(0, 0, 1, h);
        c.fillRect(w - 1, 0, 1, h);
    });
}

// ═══════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════

/**
 * 绘制密度图（参考 osu 编辑器左侧密度示意图）。
 * 竖向布局：时间从下到上递增（底部 = 歌开始，顶部 = 歌结束），
 * 播放游标随音乐从底部移动到上面。
 *  - style = 'bar'（默认直方图）：柱形（横条）厚度固定，数量 = 密度图高度 / 柱宽设置
 *    （不随歌长自适应），横条长度 = count / maxCount * 可用宽度（归一化，最高密度满格）
 *  - style = 'line'（折线图）：每个窗口中心取一个点，横向位置 = 归一化密度，
 *    相邻点连线成曲线，达到显示上限的采样点用峰值颜色标记
 *  - 达到显示上限（全谱面最高密度）→ 峰值颜色高亮，其余主题色（均可自定义）
 *  - 白色游标指示当前播放位置
 * @param {string} [normal] 正常密度颜色（默认 DENSITY_NORMAL）
 * @param {string} [hot]    达到显示上限的颜色（默认 DENSITY_HOT）
 */
function drawDensityMap(ctx, bm, currentTimeMs, x, top, w, h,
    style = 'bar', normal = DENSITY_NORMAL, hot = DENSITY_HOT,
    fillLine = true, fillAlpha = 0.35) {
    const dc = bm._densityCache;
    if (!dc) return;

    const { counts, maxCount, numBars, durationMs } = dc;
    const pad = 2;  // 内边距
    const innerW = Math.max(1, w - pad * 2);
    const sliceH = h / numBars;
    const bottom = top + h;
    const invMax = maxCount > 0 ? 1 / maxCount : 0;

    // 背景 + 圆角外框
    ctx.save();
    ctx.beginPath();
    rr(ctx, x, top, w, h, 4);
    ctx.fillStyle = DENSITY_BG;
    ctx.fill();
    ctx.clip();

    if (style === 'line') {
        // ── 折线图 ──
        const pts = [];
        for (let i = 0; i < numBars; i++) {
            const px = x + pad + (counts[i] * invMax) * innerW;
            const py = bottom - (i + 0.5) * sliceH;
            pts.push({ px, py, hot: counts[i] >= maxCount });
        }

        // 曲线下方半透明纯色填充（按设置透明度）
        if (fillLine && fillAlpha > 0) {
            ctx.beginPath();
            ctx.moveTo(x + pad, bottom);
            for (const p of pts) ctx.lineTo(p.px, p.py);
            ctx.lineTo(x + pad, bottom);
            ctx.closePath();
            ctx.fillStyle = hexA(normal, fillAlpha);
            ctx.fill();
        }

        // 外层深色描边
        ctx.strokeStyle = darken(normal, 0.55);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(pts[0].px, pts[0].py);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].px, pts[i].py);
        ctx.stroke();

        // 主折线（主题色）
        ctx.strokeStyle = normal;
        ctx.lineWidth = 1.5;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(pts[0].px, pts[0].py);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].px, pts[i].py);
        ctx.stroke();

        // 达到显示上限的采样点 → 峰值颜色（带发光）
        for (const p of pts) {
            if (!p.hot) continue;
            ctx.shadowColor = hot;
            ctx.shadowBlur = 5;
            ctx.fillStyle = hot;
            ctx.beginPath();
            ctx.arc(p.px, p.py, 2.25, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
        }
    } else {
        // ── 直方图（默认） ──
        for (let i = 0; i < numBars; i++) {
            const y    = bottom - (i + 1) * sliceH;
            const ratio = counts[i] * invMax;
            const barW = ratio * innerW;
            if (barW <= 0) continue;

            const hotBar = counts[i] >= maxCount;
            const barGrad = ctx.createLinearGradient(x + pad, y, x + pad + barW, y);
            barGrad.addColorStop(0, hotBar ? hot : normal);
            barGrad.addColorStop(1, hotBar ? lighten(hot, 0.35) : lighten(normal, 0.4));

            ctx.fillStyle = barGrad;
            ctx.globalAlpha = hotBar ? 0.92 : 0.75;
            const bh = Math.max(1, sliceH - 1);
            rr(ctx, x + pad, y, barW, bh, Math.min(2, bh / 2));
            ctx.fill();
            ctx.globalAlpha = 1;

            // 峰值条右端加细白边
            if (hotBar) {
                ctx.fillStyle = 'rgba(255,255,255,0.55)';
                ctx.fillRect(x + pad + barW - 1, y + 1, 1, bh - 2);
            }
        }
    }

    // 当前时间游标（水平亮线 + 发光 + 右端三角）
    if (durationMs > 0) {
        const pct = Math.min(Math.max(currentTimeMs / durationMs, 0), 1);
        const cy  = bottom - pct * h;
        ctx.shadowColor = DENSITY_CURSOR;
        ctx.shadowBlur = 4;
        ctx.fillStyle = DENSITY_CURSOR;
        ctx.fillRect(x + pad, cy - 0.5, innerW, 1.5);
        ctx.shadowBlur = 0;

        ctx.beginPath();
        ctx.moveTo(x + w - 1, cy - 3.5);
        ctx.lineTo(x + w - 1, cy + 3.5);
        ctx.lineTo(x + w - 5, cy);
        ctx.closePath();
        ctx.fill();
    }

    ctx.restore();
}

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
