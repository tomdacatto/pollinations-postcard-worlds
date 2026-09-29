// The parts of Postcard Worlds that are not AI: the tree of places you have
// visited, the prompts, checking the hotspots a vision model returns, and the
// share link that replays a path.

export const STYLE =
    "hand-painted gouache travel postcard, soft warm light, gentle colours, no text or lettering";

export const MAX_SPOTS = 3;
export const MAX_STEPS = 12;

// --- the world: a tree of views -------------------------------------------------

export function newWorld(scene) {
    return { scene, nodes: [{ id: 0, parent: null, label: null }], current: 0 };
}

export function addNode(world, parent, label) {
    const id = world.nodes.length;
    world.nodes.push({ id, parent, label });
    return id;
}

// Root first, ending at `id`.
export function pathTo(world, id) {
    const path = [];
    for (let n = world.nodes[id]; n; n = world.nodes[n.parent]) path.unshift(n);
    return path;
}

export const labelsTo = (world, id) =>
    pathTo(world, id)
        .slice(1)
        .map((n) => n.label);

// --- prompts --------------------------------------------------------------------

export const firstPrompt = (scene) =>
    `${scene}. A postcard view of this place, with a few doors, paths, windows or openings a visitor could walk through. ${STYLE}.`;

// Used with the previous view as a reference image: same style, new composition.
export const stepPrompt = (scene, label) =>
    `A brand new view of the same world ("${scene}"), as seen after the visitor walks to: ${label}. Same hand-painted gouache postcard style and warm palette as the reference image, but a completely different composition: do not copy the reference layout. Include a few doors, paths, windows or openings to continue through. No text or lettering.`;

export const SPOT_PROMPT = `Look at this illustration. Find 3 different places a visitor could walk into or through next: doors, gates, paths, windows, stairs, openings, boats, tunnels.
Return JSON only: {"spots":[{"label":"a 2-4 word name","box_2d":[ymin,xmin,ymax,xmax]}]}
box_2d holds integers from 0 to 1000, relative to the image height (y) and width (x), as in Gemini's object detection format.`;

// --- hotspots -------------------------------------------------------------------

const MIN_AREA = 0.002;
const MAX_AREA = 0.55;
const MIN_SIDE = 0.06; // clickable area is never smaller than this, so it is easy to hit

const clamp = (v) => Math.min(1, Math.max(0, v));

function overlap(a, b) {
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (w <= 0 || h <= 0) return 0;
    return (w * h) / (a.w * a.h + b.w * b.h - w * h);
}

// Vision models are unreliable about coordinates, so anything odd is dropped
// or clamped: boxes must be in 0-1000, sensible in size and not duplicates.
export function parseSpots(raw) {
    const list = Array.isArray(raw?.spots) ? raw.spots : [];
    const spots = [];
    for (const item of list) {
        const box = item?.box_2d;
        const label =
            typeof item?.label === "string"
                ? item.label.trim().slice(0, 32)
                : "";
        if (
            !label ||
            !Array.isArray(box) ||
            box.length !== 4 ||
            box.some((v) => !Number.isFinite(v) || v < 0 || v > 1000)
        )
            continue;
        const [y0, x0, y1, x1] = box.map((v) => v / 1000);
        const w = x1 - x0;
        const h = y1 - y0;
        if (w <= 0 || h <= 0 || w * h < MIN_AREA || w * h > MAX_AREA) continue;
        const cx = x0 + w / 2;
        const cy = y0 + h / 2;
        const sw = Math.max(w, MIN_SIDE);
        const sh = Math.max(h, MIN_SIDE);
        const spot = {
            label,
            cx,
            cy,
            x: clamp(cx - sw / 2),
            y: clamp(cy - sh / 2),
            w: sw,
            h: sh,
        };
        if (
            spots.some(
                (s) =>
                    s.label.toLowerCase() === label.toLowerCase() ||
                    overlap(s, spot) > 0.5,
            )
        )
            continue;
        spots.push(spot);
        if (spots.length === MAX_SPOTS) break;
    }
    return spots;
}

// --- share link -----------------------------------------------------------------

const b64url = (text) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(text)))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replace(/=+$/, "");
const fromB64url = (s) =>
    new TextDecoder().decode(
        Uint8Array.from(
            atob(s.replaceAll("-", "+").replaceAll("_", "/")),
            (c) => c.charCodeAt(0),
        ),
    );

// The link holds only the scene and the labels walked. Prompts are rebuilt from
// those, so a replay sends the same requests and can hit the cache.
export function encodeWorld(scene, labels) {
    return `w=${b64url(JSON.stringify({ v: 1, s: scene, p: labels }))}`;
}

export function decodeWorld(hash) {
    try {
        const raw = String(hash)
            .replace(/^#/, "")
            .split("&")
            .find((part) => part.startsWith("w="));
        if (!raw) return null;
        const data = JSON.parse(fromB64url(raw.slice(2)));
        if (
            data.v !== 1 ||
            typeof data.s !== "string" ||
            !Array.isArray(data.p)
        )
            return null;
        const scene = data.s.trim();
        const labels = data.p
            .filter((l) => typeof l === "string" && l.trim())
            .map((l) => l.trim().slice(0, 40));
        if (!scene || scene.length > 140 || data.p.length > MAX_STEPS)
            return null;
        return { scene, labels };
    } catch {
        return null;
    }
}
