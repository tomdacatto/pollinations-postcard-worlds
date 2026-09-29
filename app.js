import {
    balance,
    completeSignIn,
    getSession,
    signIn,
    signOut,
} from "./pollen.js";
import { findSpots, firstView, nextView } from "./views.js";
import {
    addNode,
    decodeWorld,
    encodeWorld,
    labelsTo,
    newWorld,
    pathTo,
} from "./world.js";

const $app = document.getElementById("app");

const EXAMPLES = [
    "a lighthouse cove at dusk",
    "a snowed-in mountain village",
    "a night market in Kyoto",
    "a desert train station at dawn",
];

const esc = (s) =>
    String(s ?? "").replace(
        /[&<>"']/g,
        (c) =>
            ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;",
            })[c],
    );

const state = {
    screen: "landing",
    error: "",
    notice: "",
    pollen: null,
    scene: "",
    world: null,
    images: {}, // node id -> { blob, url }
    spots: {}, // node id -> spots[]
    busy: "", // text shown over the picture while a view is painted
    finding: false,
    replay: decodeWorld(location.hash), // a shared path waiting to be walked
    progress: "",
};

// --- helpers ---------------------------------------------------------------------

function fail(e) {
    state.busy = "";
    state.finding = false;
    state.progress = "";
    state.error = e?.message || "Something went wrong.";
    if (e?.status === 401) state.screen = "landing";
    render();
}

async function refreshPollen() {
    state.pollen = await balance();
    const chip = document.getElementById("pollen");
    if (chip && state.pollen != null) {
        chip.textContent = `${state.pollen.toFixed(2)} Pollen`;
        chip.hidden = false;
    }
}

function keepImage(id, blob) {
    state.images[id] = { blob, url: URL.createObjectURL(blob) };
}

function reset() {
    for (const { url } of Object.values(state.images)) URL.revokeObjectURL(url);
    Object.assign(state, {
        world: null,
        images: {},
        spots: {},
        busy: "",
        finding: false,
        progress: "",
        notice: "",
    });
}

// --- views -----------------------------------------------------------------------

function header() {
    const signedIn = !!getSession();
    return `<header>
        <h1>Postcard Worlds</h1>
        <div class="right">${
            signedIn
                ? `<span class="chip" id="pollen" title="Your remaining Pollen budget" ${state.pollen == null ? "hidden" : ""}>${state.pollen == null ? "" : `${state.pollen.toFixed(2)} Pollen`}</span><button class="link" data-act="signout">Sign out</button>`
                : ""
        }</div>
    </header>`;
}

const replayCard = () =>
    state.replay
        ? `<div class="shared"><b>Someone shared a path</b><p>“${esc(state.replay.scene)}”, ${state.replay.labels.length} step${state.replay.labels.length === 1 ? "" : "s"}: ${state.replay.labels.map(esc).join(" → ") || "just the first view"}.</p></div>`
        : "";

const screens = {
    landing: () => `<section class="hero">
        <p class="kicker">Explore a world one picture at a time</p>
        <h2>Type a place. Step through its doors.</h2>
        <p>Describe a scene and an AI paints it as a postcard. A vision model finds the doors, paths and windows in the picture; click one and you step into the next view, painted to match the last. Wander as far as you like, then share your route as a link.</p>
        ${replayCard()}
        <p class="fine">Runs on Pollinations and is paid with <b>your own Pollen</b>: about half a cent per view. You choose the budget when you sign in.</p>
        <button class="btn primary big" data-act="signin">Sign in with Pollen</button>
    </section>`,

    start: () => `<section>
        ${state.replay ? `${replayCard()}<button class="btn primary big" data-act="walk-shared">Walk this path</button><p class="fine center">or start your own:</p>` : `<h2>Where to?</h2>`}
        <label>Describe a place
            <input id="scene" value="${esc(state.scene)}" maxlength="140" placeholder="a lighthouse cove at dusk" autocomplete="off">
        </label>
        <div class="examples">${EXAMPLES.map((e, i) => `<button class="chipbtn" data-act="example" data-i="${i}">${esc(e)}</button>`).join("")}</div>
        <button class="btn ${state.replay ? "" : "primary"} big" data-act="enter">Paint the postcard</button>
    </section>`,

    world() {
        const w = state.world;
        const img = state.images[w.current];
        const spots = state.spots[w.current] ?? [];
        const path = pathTo(w, w.current);
        const hot = spots
            .map(
                (s, i) =>
                    `<button class="spot ${i % 2 ? "up" : ""}" style="left:${s.x * 100}%;top:${s.y * 100}%;width:${s.w * 100}%;height:${s.h * 100}%" data-act="walk" data-i="${i}" aria-label="Go to ${esc(s.label)}" ${state.busy ? "disabled" : ""}><span class="dot"></span><span class="tag">${esc(s.label)}</span></button>`,
            )
            .join("");
        const crumbs = path
            .map(
                (n, i) =>
                    `${i ? `<span class="arrow" title="${esc(n.label)}">→</span>` : ""}<button class="crumb ${n.id === w.current ? "on" : ""}" data-act="goto" data-id="${n.id}" aria-label="${i === 0 ? "First view" : esc(n.label)}" ${state.busy ? "disabled" : ""}>${state.images[n.id] ? `<img src="${state.images[n.id].url}" alt="">` : ""}<span>${i === 0 ? "start" : esc(n.label)}</span></button>`,
            )
            .join("");
        return `<section class="world">
            <p class="scene">“${esc(w.scene)}”</p>
            <div class="stage ${state.busy ? "busy" : ""}">
                ${img ? `<img src="${img.url}" alt="A painted postcard view of ${esc(w.scene)}">` : `<div class="blank"></div>`}
                ${hot}
                ${state.busy ? `<div class="veil"><div class="spinner"></div><p>${esc(state.busy)}</p>${state.progress ? `<small>${esc(state.progress)}</small>` : ""}</div>` : ""}
                ${state.finding && !state.busy ? `<div class="finding">Looking for ways in…</div>` : ""}
                ${!state.finding && !state.busy && !spots.length ? `<div class="finding">No way onward here. Go back or start over.</div>` : ""}
            </div>
            <div class="crumbs" aria-label="Your route">${crumbs}</div>
            <div class="actions">
                <button class="btn small" data-act="share">Copy replay link</button>
                <button class="btn small" data-act="save">Save postcard</button>
                <button class="btn small ghost" data-act="new">New world</button>
            </div>
            ${state.notice ? `<p class="fine center" role="status">${esc(state.notice)}</p>` : ""}
            <p class="fine center">${path.length} view${path.length === 1 ? "" : "s"} on this route. Each new view costs about half a cent of Pollen.</p>
        </section>`;
    },
};

function render() {
    const focused = document.activeElement?.id === "scene";
    $app.innerHTML = `${header()}${state.error ? `<div class="error" role="alert">${esc(state.error)}</div>` : ""}${(screens[state.screen] ?? screens.landing)()}`;
    if (focused) document.getElementById("scene")?.focus();
}

// --- flow ------------------------------------------------------------------------

async function loadSpots(id) {
    if (state.spots[id]) return;
    state.finding = true;
    render();
    try {
        const spots = await findSpots(state.images[id].blob);
        state.spots[id] = spots;
    } catch (e) {
        state.finding = false;
        return fail(e);
    }
    state.finding = false;
    render();
    refreshPollen();
}

async function enter(scene) {
    const text = scene.trim();
    if (text.length < 3) {
        state.error = "Describe a place first, a few words is enough.";
        return render();
    }
    reset();
    state.scene = text;
    state.error = "";
    state.world = newWorld(text);
    state.screen = "world";
    state.busy = "Painting your postcard…";
    // The frame shows straight away, blank, while the first view paints.
    render();
    try {
        keepImage(0, await firstView(text));
    } catch (e) {
        state.world = null;
        state.screen = "start";
        return fail(e);
    }
    state.busy = "";
    render();
    loadSpots(0);
}

async function walk(spot) {
    const w = state.world;
    const from = w.current;
    state.busy = `Stepping through: ${spot.label}…`;
    state.error = "";
    render();
    try {
        const blob = await nextView(
            w.scene,
            spot.label,
            state.images[from].blob,
        );
        const id = addNode(w, from, spot.label);
        keepImage(id, blob);
        w.current = id;
    } catch (e) {
        return fail(e);
    }
    state.busy = "";
    render();
    loadSpots(w.current);
}

async function walkShared() {
    const { scene, labels } = state.replay;
    reset();
    state.scene = scene;
    state.error = "";
    state.world = newWorld(scene);
    state.screen = "world";
    state.busy = "Painting the first view…";
    render();
    try {
        keepImage(0, await firstView(scene));
        let at = 0;
        for (const [i, label] of labels.entries()) {
            state.progress = `Step ${i + 1} of ${labels.length}: ${label}`;
            state.busy = "Following the shared path…";
            render();
            const blob = await nextView(scene, label, state.images[at].blob);
            at = addNode(state.world, at, label);
            keepImage(at, blob);
            state.world.current = at;
        }
    } catch (e) {
        if (!state.images[0]) {
            state.world = null;
            state.screen = "start";
        }
        return fail(e);
    }
    state.busy = "";
    state.progress = "";
    state.replay = null;
    history.replaceState(null, "", location.pathname);
    render();
    loadSpots(state.world.current);
}

async function share() {
    const w = state.world;
    const url = `${location.origin}${location.pathname}#${encodeWorld(w.scene, labelsTo(w, w.current))}`;
    try {
        await navigator.clipboard.writeText(url);
        state.notice =
            "Link copied. Anyone who opens it can walk your route with their own Pollen.";
    } catch {
        state.notice = url;
    }
    render();
}

function save() {
    const { blob } = state.images[state.world.current];
    const url = URL.createObjectURL(blob);
    Object.assign(document.createElement("a"), {
        href: url,
        download: "postcard.png",
    }).click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const actions = {
    signin() {
        // The redirect back drops the #fragment, so keep a shared path across sign-in.
        if (state.replay) sessionStorage.setItem("pw.hash", location.hash);
        signIn().catch(fail);
    },
    signout() {
        signOut();
        reset();
        Object.assign(state, { screen: "landing", pollen: null });
        render();
    },
    example({ i }) {
        const box = document.getElementById("scene");
        box.value = EXAMPLES[Number(i)];
        state.scene = box.value;
    },
    enter: () => enter(document.getElementById("scene").value),
    "walk-shared": walkShared,
    walk({ i }) {
        const spot = state.spots[state.world.current]?.[Number(i)];
        if (spot) walk(spot);
    },
    goto({ id }) {
        state.world.current = Number(id);
        render();
        loadSpots(Number(id));
    },
    share,
    save,
    new() {
        reset();
        state.screen = "start";
        render();
    },
};

$app.addEventListener("click", (e) => {
    const el = e.target.closest("[data-act]");
    if (el && !el.disabled) actions[el.dataset.act]?.(el.dataset);
});
$app.addEventListener("input", (e) => {
    if (e.target.id === "scene") state.scene = e.target.value;
});
$app.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.id === "scene") actions.enter();
});

(async () => {
    const saved = sessionStorage.getItem("pw.hash");
    if (saved) {
        sessionStorage.removeItem("pw.hash");
        if (!location.hash)
            history.replaceState(null, "", `${location.pathname}${saved}`);
        state.replay = decodeWorld(saved);
    }
    try {
        await completeSignIn();
    } catch (e) {
        state.error = e.message;
    }
    if (getSession()) {
        state.screen = "start";
        refreshPollen();
    }
    render();
})();
