// The three AI calls: paint the first view, paint the next one from the last,
// and find the places you can walk into.
import { postForm, postJson } from "./pollen.js";
import { firstPrompt, parseSpots, SPOT_PROMPT, stepPrompt } from "./world.js";

// flux.2-klein-4b takes reference images and turns them into a new scene in
// the same style, for about half a cent a view.
export const IMAGE_MODEL = "black-forest-labs/flux.2-klein-4b";
const SPOT_MODELS = [
    "google/gemini-3.5-flash-lite",
    "google/gemini-2.5-flash-lite",
];
const SIZE = "1024x768";

const toBlob = (b64) =>
    new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], {
        type: "image/png",
    });

export async function firstView(scene, signal) {
    const res = await postJson(
        "/v1/images/generations",
        { model: IMAGE_MODEL, prompt: firstPrompt(scene), size: SIZE },
        signal,
    );
    return toBlob((await res.json()).data[0].b64_json);
}

// `reference` is the view the visitor is standing in.
export async function nextView(scene, label, reference, signal) {
    const form = new FormData();
    form.append(
        "image",
        new File([reference], "view.png", {
            type: reference.type || "image/png",
        }),
    );
    form.append("prompt", stepPrompt(scene, label));
    form.append("model", IMAGE_MODEL);
    form.append("size", SIZE);
    const res = await postForm("/v1/images/edits", form, signal);
    return toBlob((await res.json()).data[0].b64_json);
}

const dataUrl = (blob) =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });

// Asks a vision model for the doors, paths and windows in a view. If the first
// model returns nothing usable, the second gets a try.
export async function findSpots(blob, signal) {
    const url = await dataUrl(blob);
    for (const model of SPOT_MODELS) {
        try {
            const res = await postJson(
                "/v1/chat/completions",
                {
                    model,
                    response_format: { type: "json_object" },
                    messages: [
                        {
                            role: "user",
                            content: [
                                { type: "text", text: SPOT_PROMPT },
                                { type: "image_url", image_url: { url } },
                            ],
                        },
                    ],
                },
                signal,
            );
            const text =
                (await res.json()).choices?.[0]?.message?.content ?? "";
            const spots = parseSpots(
                JSON.parse(
                    text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1),
                ),
            );
            if (spots.length >= 2) return spots;
        } catch (e) {
            if (e.status === 401 || e.status === 402 || e.name === "AbortError")
                throw e;
        }
    }
    return [];
}
