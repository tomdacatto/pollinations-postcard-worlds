# Postcard Worlds

Type a place. An AI paints it as a postcard, a vision model finds the doors, paths and windows in the picture, and clicking one steps you into the next view, painted to match the last. Explore a small world one picture at a time, then share your route as a link.

**Explore:** https://tomdacatto.github.io/pollinations-postcard-worlds/

Runs on [Pollinations](https://pollinations.ai) and is paid with the visitor's own Pollen through [Bring Your Own Pollen](https://github.com/pollinations/pollinations/blob/main/BRING_YOUR_OWN_POLLEN.md). No backend: the page talks to `gen.pollinations.ai` directly and the key lives in `sessionStorage` for that tab. Each new view costs about half a cent (0.005 for the picture plus about 0.0007 to find the spots).

## How it works

1. **First view.** `POST /v1/images/generations` paints your scene as a gouache postcard.
2. **Find the doors.** The picture goes to a vision model (`google/gemini-3.5-flash-lite`) that returns 3 clickable places as bounding boxes in Gemini's `box_2d` format. Vision models are unreliable about coordinates, so [`parseSpots`](world.js) drops boxes that are out of range, tiny, huge or duplicates, and never lets a clickable area shrink below 6% of the picture. If the first model gives fewer than two usable spots, a second model gets a try.
3. **Step through.** Clicking a spot sends the current picture as a **reference image** to `POST /v1/images/edits` (`black-forest-labs/flux.2-klein-4b`) with a prompt to show what is on the other side. The reference keeps the palette and painting style consistent, while the prompt asks for a completely different composition (edit-style models tend to redraw the same picture, so this was checked on real output before choosing the model).
4. **Route.** A breadcrumb strip of thumbnails shows the path. Go back to any earlier view and choose a different spot to branch.
5. **Share.** "Copy replay link" encodes the scene and the labels you walked into the URL fragment. Opening it offers to walk the same path; the prompts are rebuilt from those labels, so a replay sends the same requests as the original.

## Models

| Job | Endpoint / model |
| --- | --- |
| Views | `POST /v1/images/generations` and `POST /v1/images/edits` (multipart, reference image), `black-forest-labs/flux.2-klein-4b` |
| Doors, paths and windows | `POST /v1/chat/completions` with an `image_url` part, `google/gemini-3.5-flash-lite` (fallback `google/gemini-2.5-flash-lite`) |

## Run it

Serve the folder with any static server. Sign-in needs the deployed URL (the App Key's redirect URI is `https://tomdacatto.github.io/pollinations-postcard-worlds/`); to run your own copy, create an App Key at [enter.pollinations.ai/keys](https://enter.pollinations.ai/keys), register your URL as its redirect URI and put the key in `config.js`.

```bash
node --test world.test.js
```

## Files

- `world.js`, `world.test.js`: the tree of views, prompts, hotspot validation and the share link, with tests
- `views.js`: the three AI calls
- `pollen.js`: Bring Your Own Pollen sign-in (OAuth code + PKCE) and the Pollinations client
- `app.js`, `index.html`, `style.css`: the UI

MIT licensed.
