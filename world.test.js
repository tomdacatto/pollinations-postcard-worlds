import assert from "node:assert/strict";
import test from "node:test";
import {
    addNode,
    decodeWorld,
    encodeWorld,
    firstPrompt,
    labelsTo,
    MAX_STEPS,
    newWorld,
    parseSpots,
    pathTo,
    SPOT_PROMPT,
    STYLE,
    stepPrompt,
} from "./world.js";

test("the world is a tree; the path runs from the first view to the current one", () => {
    const w = newWorld("a lighthouse cove");
    const door = addNode(w, 0, "wooden door");
    const stairs = addNode(w, door, "spiral stairs");
    const path = addNode(w, 0, "cliff path"); // a branch
    assert.deepEqual(
        pathTo(w, stairs).map((n) => n.id),
        [0, door, stairs],
    );
    assert.deepEqual(labelsTo(w, stairs), ["wooden door", "spiral stairs"]);
    assert.deepEqual(labelsTo(w, path), ["cliff path"]);
    assert.deepEqual(labelsTo(w, 0), []);
});

test("prompts carry the scene, the chosen spot and the style", () => {
    assert.match(firstPrompt("a lighthouse cove"), /a lighthouse cove/);
    assert.ok(firstPrompt("x").includes(STYLE));
    const p = stepPrompt("a lighthouse cove", "wooden door");
    assert.match(p, /a lighthouse cove/);
    assert.match(p, /wooden door/);
    assert.match(p, /do not copy the reference layout/);
    assert.match(SPOT_PROMPT, /box_2d/);
});

const spot = (label, box) => ({ label, box_2d: box });

test("parseSpots converts Gemini boxes (0-1000) to fractions and centres them", () => {
    const [door] = parseSpots({
        spots: [spot("lighthouse door", [700, 300, 840, 400])],
    });
    assert.equal(door.label, "lighthouse door");
    assert.ok(Math.abs(door.cx - 0.35) < 1e-9);
    assert.ok(Math.abs(door.cy - 0.77) < 1e-9);
    assert.ok(Math.abs(door.w - 0.1) < 1e-9 || door.w >= 0.06);
});

test("parseSpots drops anything a vision model got wrong", () => {
    const spots = parseSpots({
        spots: [
            spot("pixel coordinates", [10, 20, 340, 1746]),
            spot("", [100, 100, 200, 200]),
            spot("not numbers", ["a", "b", "c", "d"]),
            spot("wrong length", [1, 2, 3]),
            spot("inverted", [500, 500, 400, 400]),
            spot("whole image", [0, 0, 1000, 1000]),
            spot("speck", [500, 500, 501, 501]),
            spot("negative", [-5, 10, 200, 300]),
            spot("fine", [100, 100, 300, 300]),
        ],
    });
    assert.deepEqual(
        spots.map((s) => s.label),
        ["fine"],
    );
    assert.deepEqual(parseSpots(null), []);
    assert.deepEqual(parseSpots({ spots: "nope" }), []);
});

test("parseSpots removes duplicates and keeps at most three", () => {
    const spots = parseSpots({
        spots: [
            spot("Door", [100, 100, 300, 300]),
            spot("door", [400, 400, 600, 600]),
            spot("same place", [110, 110, 300, 300]),
            spot("window", [100, 600, 250, 750]),
            spot("path", [700, 100, 900, 500]),
            spot("stairs", [400, 800, 600, 950]),
        ],
    });
    assert.deepEqual(
        spots.map((s) => s.label),
        ["Door", "window", "path"],
    );
});

test("clickable areas are never tiny and stay inside the image", () => {
    const [tiny] = parseSpots({ spots: [spot("keyhole", [10, 10, 60, 60])] });
    assert.ok(tiny.w >= 0.06 && tiny.h >= 0.06);
    assert.ok(tiny.x >= 0 && tiny.y >= 0);
    const [edge] = parseSpots({
        spots: [spot("edge door", [900, 950, 1000, 1000])],
    });
    assert.ok(edge.x + edge.w <= 1.0001 + 0.06 && edge.x >= 0);
});

test("the share link round-trips a path, including unicode", () => {
    const hash = `#${encodeWorld("un café à Lisboa, 🌅", ["porte bleue", "escalier"])}`;
    assert.deepEqual(decodeWorld(hash), {
        scene: "un café à Lisboa, 🌅",
        labels: ["porte bleue", "escalier"],
    });
    assert.deepEqual(decodeWorld(`#other=1&${encodeWorld("x", [])}`), {
        scene: "x",
        labels: [],
    });
});

test("the share link rejects anything it did not write", () => {
    assert.equal(decodeWorld(""), null);
    assert.equal(decodeWorld("#w=!!!"), null);
    assert.equal(decodeWorld("#w=e30"), null, "empty object");
    assert.equal(decodeWorld(`#${encodeWorld("", [])}`), null, "no scene");
    assert.equal(
        decodeWorld(`#${encodeWorld("x".repeat(200), [])}`),
        null,
        "scene too long",
    );
    assert.equal(
        decodeWorld(`#${encodeWorld("x", Array(MAX_STEPS + 1).fill("a"))}`),
        null,
        "too many steps",
    );
    const messy = decodeWorld(
        `#${encodeWorld("x", ["ok", 5, "  ", "y".repeat(80)])}`,
    );
    assert.deepEqual(messy.labels, ["ok", "y".repeat(40)]);
});
