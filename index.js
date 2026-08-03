import WebSocketManager from './js/socket.js';
import { renderGameplayFrame, buildPianoLayout, buildRenderColors } from './js/preview_renderer.js';

// ============ 常量 ============
const STATE_MENU   = 0;
const STATE_SELECT = 5;
const BASE_MS_VISIBLE = 11485;

// ============ DOM ============
const container = document.getElementById('preview-container');
const canvas    = document.getElementById('gameplay-canvas');

// ============ 状态 ============
const cache = {
    checksum: '',
    hasLoaded: false,
    previousState: -1,
    bm: null,
    animId: null,
    animStart: 0,
    previewTimeMs: 0,
    noteColors: [],
    lnColors: [],
    layout: null,
    renderColors: null,
    lastAudioTime: 0,
    beatmapSetId: null,
};

// ============ 用户设置 ============
const settings = {
    canvasWidth:  300,
    canvasHeight: 600,
    showInMenu:   false,
    debugLog:     false,
    speed:        25,
    noteThickness: 20,
    showJudgmentLine: true,
    noteStyle: false,
    noteEffects: true,
    colors: { col1: '#c8c8eb', col2: '#c8c8eb', col3: '#c8c8eb', col4: '#c8c8eb', ln: '#9696c3' },
};

const log = (...a) => { if (settings.debugLog) console.log('[Preview]', ...a); };
const err = (...a) => console.error('[Preview]', ...a);

// ============ WebSocket ============
const socket = new WebSocketManager(window.location.host);

// ============ Settings API ============
if (window.COUNTER_PATH) {
    socket.sendCommand('getSettings', encodeURI(window.COUNTER_PATH));
}

socket.commands((data) => {
    try { if (data.command === 'getSettings') applySettings(data.message); }
    catch (e) { err('Settings error:', e); }
});

function applySettings(msg) {
    if (!msg || typeof msg !== 'object') return;
    const num = (v, d) => Math.max(1, parseInt(v) || d);
    if (msg.canvasWidth  !== undefined) settings.canvasWidth  = num(msg.canvasWidth,  300);
    if (msg.canvasHeight !== undefined) settings.canvasHeight = num(msg.canvasHeight, 600);
    if (msg.showInMenu   !== undefined) settings.showInMenu   = msg.showInMenu;
    if (msg.debugLog     !== undefined) settings.debugLog     = msg.debugLog;
    if (msg.noteThickness !== undefined) settings.noteThickness = Math.max(1, num(msg.noteThickness, 20));
    if (msg.speed        !== undefined) settings.speed        = Math.max(1, Math.min(40, num(msg.speed, 25)));
    if (msg.col1Color    !== undefined) settings.colors.col1  = msg.col1Color;
    if (msg.col2Color    !== undefined) settings.colors.col2  = msg.col2Color;
    if (msg.col3Color    !== undefined) settings.colors.col3  = msg.col3Color;
    if (msg.col4Color    !== undefined) settings.colors.col4  = msg.col4Color;
    if (msg.lnColor      !== undefined) settings.colors.ln    = msg.lnColor;
    if (msg.showJudgmentLine !== undefined) settings.showJudgmentLine = msg.showJudgmentLine;
    if (msg.noteStyle        !== undefined) settings.noteStyle        = msg.noteStyle;
    if (msg.noteEffects      !== undefined) settings.noteEffects      = msg.noteEffects;
    log('Settings applied', settings);
}

// ============ UI ============
const showPreview  = () => container.classList.add('visible');
const hidePreview  = () => container.classList.remove('visible');

// ============ 加载动画 ============
function startLoadingAnim() {
    stopAnimation();
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    const cx = w / 2, cy = h / 2;
    const r  = Math.min(w, h) * 0.08;
    const dots = 8;
    if (cache.animId) cancelAnimationFrame(cache.animId);

    (function spinner(now) {
        ctx.fillStyle = '#141420';
        ctx.fillRect(0, 0, w, h);

        for (let i = 0; i < dots; i++) {
            const angle = (now / 600) + (i / dots) * Math.PI * 2;
            const alpha = 0.2 + 0.8 * ((i / dots));
            const dx = cx + Math.cos(angle) * r;
            const dy = cy + Math.sin(angle) * r;
            ctx.fillStyle = `rgba(200,200,235,${alpha.toFixed(2)})`;
            ctx.beginPath();
            ctx.arc(dx, dy, 3, 0, Math.PI * 2);
            ctx.fill();
        }
        cache.animId = requestAnimationFrame(spinner);
    })();
}

// ============ 动画 ============
function stopAnimation() {
    if (cache.animId) { cancelAnimationFrame(cache.animId); cache.animId = null; }
}

function buildBeatSections(utps, totalMs) {
    if (!utps.length) return [[0, 500, totalMs + 1]];
    const srt = utps.slice().sort((a, b) => a.time - b.time);
    return srt.map((tp, i) => [
        tp.time, tp.beatLength,
        i + 1 < srt.length ? srt[i + 1].time : totalMs + 1,
    ]);
}

function startAnimation() {
    stopAnimation();
    if (!cache.bm) return;

    const bm = cache.bm;
    const startMs = cache.previewTimeMs;
    const dur = bm.durationMs - startMs;
    if (dur <= 0) return;

    const visibleMs = BASE_MS_VISIBLE / Math.max(1, settings.speed);
    cache.animStart = performance.now();

    (function frame(now) {
        const currentTimeMs = startMs + (((now - cache.animStart) / 1000 * 1000) % dur);

        renderGameplayFrame(canvas, bm, currentTimeMs, cache.layout, cache.renderColors, {
            visibleMs,
            noteThickness: settings.noteThickness,
            showJudgmentLine: settings.showJudgmentLine,
            noteStyle: settings.noteStyle,
            noteEffects: settings.noteEffects,
        });
        drawInfoBar();
        cache.animId = requestAnimationFrame(frame);
    })();
}

function drawInfoBar() {
    const { bm, layout } = cache;
    if (!bm || !layout) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const barH = layout.pianoTop;  // 与钢琴顶部对齐

    const g = ctx.createLinearGradient(0, 0, 0, barH);
    g.addColorStop(0, 'rgba(26,26,40,0.95)');
    g.addColorStop(1, 'rgba(18,18,28,0.95)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, barH);

    const ag = ctx.createLinearGradient(0, 0, w, 0);
    ag.addColorStop(0, 'rgba(255,102,170,0.85)');
    ag.addColorStop(0.5, 'rgba(255,102,170,0.25)');
    ag.addColorStop(1, 'rgba(255,102,170,0)');
    ctx.fillStyle = ag;
    ctx.fillRect(0, barH - 1, w, 1);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px "Segoe UI", "Microsoft YaHei", sans-serif';
    const rawTitle = bm.title || bm.titleUnicode || 'Unknown';
    let title = rawTitle;
    const maxW = w * 0.5;
    if (ctx.measureText(rawTitle).width > maxW) {
        while (title.length > 1 && ctx.measureText(title + '…').width > maxW) {
            title = title.slice(0, -1);
        }
        title += '…';
    }
    ctx.fillText(title, 8, 17);

    ctx.fillStyle = '#a0a0c0';
    ctx.font = '11px "Segoe UI", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`BPM ${Math.round(bm.bpm)}`, w - 8, 17);
    ctx.textAlign = 'left';
}

// ============ 解析 .osu ============
function parseOsuFileHits(content) {
    const sections = {};
    let section = null;

    for (const line of content.split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith('//')) continue;
        const m = t.match(/^\[(.+)\]$/);
        if (m) { section = m[1]; continue; }
        if (section) (sections[section] ??= []).push(t);
    }

    // General
    let mode = 0, previewTime = -1;
    (sections['General'] || []).forEach(line => {
        const i = line.indexOf(':');
        if (i < 0) return;
        const k = line.slice(0, i).trim(), v = line.slice(i + 1).trim();
        if (k === 'Mode') mode = parseInt(v) || 0;
        if (k === 'PreviewTime') previewTime = parseInt(v) || -1;
    });

    // Difficulty
    let cs = 4, hp = 5, od = 5, ar = 5;
    (sections['Difficulty'] || []).forEach(line => {
        const i = line.indexOf(':');
        if (i < 0) return;
        const k = line.slice(0, i).trim(), v = parseFloat(line.slice(i + 1).trim());
        if (k === 'CircleSize')          cs = Math.round(v) || 4;
        else if (k === 'HPDrainRate')    hp = v || 5;
        else if (k === 'OverallDifficulty') od = v || 5;
        else if (k === 'ApproachRate')   ar = v || 5;
    });

    // Metadata
    let titleUnicode = '', artistUnicode = '', source = '';
    (sections['Metadata'] || []).forEach(line => {
        const i = line.indexOf(':');
        if (i < 0) return;
        const k = line.slice(0, i).trim(), v = line.slice(i + 1).trim();
        if (k === 'TitleUnicode')  titleUnicode  = v;
        if (k === 'ArtistUnicode') artistUnicode = v;
        if (k === 'Source')        source        = v;
    });

    // TimingPoints
    const timingPoints = [];
    (sections['TimingPoints'] || []).forEach(line => {
        const p = line.split(',');
        if (p.length < 2) return;
        timingPoints.push({ time: +p[0], beatLength: +p[1], meter: +p[2] || 4, inherited: +p[1] < 0 });
    });

    // HitObjects
    const hitObjects = [];
    let noteCount = 0, lnCount = 0;
    (sections['HitObjects'] || []).forEach(line => {
        const p = line.split(',');
        if (p.length < 5) return;
        const x = +p[0], time = +p[2], type = +p[3];
        let endTime = 0;
        if (type & 128 && p.length >= 6) {
            const ci = p[5].indexOf(':');
            endTime = ci > 0 ? +p[5].slice(0, ci) : +p[5];
        }
        hitObjects.push({ x, time, type, endTime });
        type & 128 ? lnCount++ : noteCount++;
    });

    const lastObj = hitObjects.length ? Math.max(...hitObjects.map(o => Math.max(o.time, o.endTime || 0))) : 0;
    const durationMs = lastObj + 1000;

    // BPM
    const utps = timingPoints.filter(tp => !tp.inherited && tp.beatLength > 0);
    const bpms = utps.map(tp => 60000 / tp.beatLength);
    const sorted = bpms.slice().sort((a, b) => a - b);
    const bpmMin = sorted[0] || 180;
    const bpmMax = sorted[sorted.length - 1] || 180;

    return { mode, circleSize: cs, previewTime, hp, od, ar,
             titleUnicode, artistUnicode, source,
             timingPoints, hitObjects,
             bpmMin, bpmMax, noteCount, lnCount, durationMs };
}

// ============ 加载谱面 ============
async function loadBeatmapPreview(data, sameSet = false) {
    cache.hasLoaded = true;
    stopAnimation();

    // Canvas 尺寸从设置读取
    canvas.width  = settings.canvasWidth;
    canvas.height = settings.canvasHeight;
    showPreview();
    startLoadingAnim();

    try {
        const folder  = data.folders?.beatmap;
        const osuFile = data.files?.beatmap;
        if (!folder || !osuFile) return;

        const osuText = await socket.getBeatmapOsuFile(`${folder}/${osuFile}`);
        if (!osuText || typeof osuText !== 'string' || osuText.error
            || osuText.startsWith('ENOENT') || !osuText.includes('[HitObjects]')) {
            err('读取 .osu 失败:', osuText?.slice(0, 80));
            return;
        }

        const hits = parseOsuFileHits(osuText);
        const b = data.beatmap || {};
        const rawMode = b.mode ?? b.modeId ?? hits.mode;
        const modeStr = typeof rawMode === 'number'
            ? ({ 1: 'osu!taiko', 2: 'osu!catch', 3: 'osu!mania' }[rawMode] || 'osu!')
            : String(rawMode || '');

        cache.bm = {
            title: b.title || '', titleUnicode: hits.titleUnicode || b.titleUnicode || b.title || '',
            artist: b.artist || '', artistUnicode: hits.artistUnicode || b.artistUnicode || b.artist || '',
            creator: b.mapper || '', version: b.version || '',
            beatmapId: b.id || 0, beatmapSetId: b.set || 0,
            mode: rawMode, modeName: modeStr,
            keyCount: Number(hits.circleSize || b.stats?.cs) || 4,
            bpm: Number(b.stats?.bpm?.common) || 180,
            hp: hits.hp, od: hits.od, ar: hits.ar, source: hits.source,
            bpmMin: hits.bpmMin, bpmMax: hits.bpmMax,
            noteCount: hits.noteCount, lnCount: hits.lnCount, durationMs: hits.durationMs,
            timingPoints: hits.timingPoints, hitObjects: hits.hitObjects,
        };

        // 预缓存 — 避免每帧重复计算
        const utps = hits.timingPoints.filter(tp => !tp.inherited && tp.beatLength > 0);
        cache.bm._utpsCache = utps;
        cache.bm._beatSectsCache = buildBeatSections(utps, hits.durationMs);

        // 同曲不同难度：接着当前音频时间播放；否则从 PreviewTime 开始
        if (sameSet && cache.lastAudioTime > 0) {
            const maxMs = hits.durationMs;
            cache.previewTimeMs = maxMs > 0 ? cache.lastAudioTime % maxMs : cache.lastAudioTime;
        } else {
            cache.previewTimeMs = hits.previewTime >= 0 ? hits.previewTime : 0;
        }
        cache.beatmapSetId = b.set || null;
        const { col1, col2, col3, col4, ln } = settings.colors;
        cache.noteColors = [col1, col2, col3, col4];
        cache.lnColors   = [ln, ln, ln, ln];

        cache.layout = buildPianoLayout(canvas.width, canvas.height, cache.bm.keyCount);
        cache.renderColors = buildRenderColors(cache.noteColors, cache.lnColors, cache.bm.keyCount);

        log('Playing:', cache.bm.title, `${cache.bm.keyCount}K preview=${cache.previewTimeMs}ms size=${canvas.width}x${canvas.height}`);

        showPreview();
        startAnimation();

    } catch (e) {
        err('加载失败:', e);
        hidePreview();
    }
}

// ============ WebSocket 监听 ============
const SELECT_NAMES = new Set([
    'SongSelect', 'songSelect', 'SelectPlay', 'selectPlay',
    'Select', 'select', 'Working', 'working',
]);

function isShowState(num, name) {
    return SELECT_NAMES.has(name) || num === STATE_SELECT
        || (settings.showInMenu && num === STATE_MENU);
}

socket.api_v2((data) => {
    try {
        const stateNum  = data.state?.number ?? -1;
        const stateName = data.state?.name || '';
        const checksum  = data.beatmap?.checksum || null;
        const showable  = isShowState(stateNum, stateName);

        // 追踪音频播放时间
        const liveTime = data.beatmap?.time?.live;
        if (typeof liveTime === 'number') cache.lastAudioTime = liveTime;

        console.log(`[Preview] num=${stateNum} name="${stateName}" checksum=${checksum?.slice(0, 8) || 'null'} showable=${showable}`);

        if (showable) {
            if (checksum && checksum !== cache.checksum) {
                const sameSet = data.beatmap?.set != null && data.beatmap.set === cache.beatmapSetId;
                console.log('[Preview] 切歌，重新加载' + (sameSet ? '（同曲不同难度，接续时间）' : ''));
                cache.checksum = checksum;
                loadBeatmapPreview(data, sameSet);
            } else if (!cache.hasLoaded && checksum) {
                console.log('[Preview] 首次进入，加载');
                loadBeatmapPreview(data, false);
            } else if (cache.previousState !== stateNum && checksum) {
                console.log('[Preview] 切回，恢复');
                showPreview();
                startAnimation();
            }
            cache.previousState = stateNum;
            return;
        }

        stopAnimation();
        hidePreview();
        cache.previousState = stateNum;

        if (checksum && checksum !== cache.checksum) {
            cache.checksum = checksum;
            cache.hasLoaded = false;
            cache.bm = null;
        }

    } catch (e) { err('Data error:', e); }
}, [
    'profile', 'settings', 'play', 'performance', 'leaderboard',
    'resultsScreen', 'tourney', 'session',
    { field: 'folders', keys: ['beatmap'] },
    { field: 'files',  keys: ['beatmap', 'background'] },
    { field: 'state',  keys: ['number', 'name'] },
    {
        field: 'beatmap',
        keys: ['checksum', 'title', 'titleUnicode', 'artist', 'artistUnicode',
               'mapper', 'version', 'id', 'set', 'mode', 'modeId',
               { field: 'stats', keys: ['cs', 'hp', 'od', 'ar', 'bpm'] },
               { field: 'time', keys: ['live'] }],
    },
]);
