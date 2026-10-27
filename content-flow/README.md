# Content Flow

A screenshot of an Instagram profile in, two weeks of content out: which day
is a Reel, a carousel, a post or a story; what each is for (teach, entertain,
sell, bring people closer); the hook, the frames, the caption, the hashtags,
how to shoot it, and the template to shoot it with. Turkish first, English
with one tap.

One Node process, no dependencies, one page. Nothing is stored: the picture
goes to the model once, with the request, and is forgotten.

```
ANTHROPIC_API_KEY=sk-... node server.js      # http://localhost:4100
node tests/test.js                           # parsing + a browser pass with a mocked model
```

`render.yaml` deploys it as its own Render service from this folder
(`rootDir: content-flow`). Set `ANTHROPIC_API_KEY` there.

The page also has a bundled sample plan ("Örnek planı gör") so it can be
shown without a key.
