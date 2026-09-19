"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  computeEdgeMap,
  computeTargetSize,
  thresholdEdgeMap,
  type EdgeMap,
} from "@/lib/lineArt";

type Status = "empty" | "loading" | "ready";

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("That file couldn't be read as an image."));
    img.src = src;
  });
}

export default function Home() {
  const [status, setStatus] = useState<Status>("empty");
  const [error, setError] = useState<string | null>(null);
  const [sensitivity, setSensitivity] = useState(50);
  const [edgeMap, setEdgeMap] = useState<EdgeMap | null>(null);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [pokemonInput, setPokemonInput] = useState("");

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const objectUrlRef = useRef<string | null>(null);

  const processImage = useCallback((img: HTMLImageElement, previewUrl: string) => {
    const { width, height } = computeTargetSize(img.naturalWidth, img.naturalHeight);
    const off = document.createElement("canvas");
    off.width = width;
    off.height = height;
    const ctx = off.getContext("2d");
    if (!ctx) {
      setError("This browser can't process images.");
      setStatus("empty");
      return;
    }
    // Fill white first so transparent PNGs don't composite against black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);
    const map = computeEdgeMap(imageData);

    if (objectUrlRef.current && objectUrlRef.current !== previewUrl) {
      URL.revokeObjectURL(objectUrlRef.current);
    }
    objectUrlRef.current = previewUrl;

    setEdgeMap(map);
    setOriginalUrl(previewUrl);
    setStatus("ready");
  }, []);

  const runWithImage = useCallback(
    (img: HTMLImageElement, previewUrl: string) => {
      // Let the "loading" UI paint before the heavy synchronous pass.
      setStatus("loading");
      setError(null);
      setTimeout(() => {
        try {
          processImage(img, previewUrl);
        } catch {
          setError("Something went wrong while processing that image.");
          setStatus("empty");
        }
      }, 30);
    },
    [processImage]
  );

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) {
        setError("Please choose an image file.");
        return;
      }
      setError(null);
      const objectUrl = URL.createObjectURL(file);
      try {
        const img = await loadImageElement(objectUrl);
        runWithImage(img, objectUrl);
      } catch {
        URL.revokeObjectURL(objectUrl);
        setError("That file couldn't be read as an image.");
      }
    },
    [runWithImage]
  );

  const loadFromProxiedUrl = useCallback(
    async (imageUrl: string) => {
      const res = await fetch(`/api/fetch-image?url=${encodeURIComponent(imageUrl)}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Couldn't load that image.");
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      try {
        const img = await loadImageElement(objectUrl);
        runWithImage(img, objectUrl);
      } catch (err) {
        URL.revokeObjectURL(objectUrl);
        throw err;
      }
    },
    [runWithImage]
  );

  const handleUrlSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = urlInput.trim();
      if (!trimmed) return;
      if (!/^https?:\/\//i.test(trimmed)) {
        setError("Please paste a link that starts with http:// or https://");
        return;
      }
      setError(null);
      setStatus("loading");
      try {
        await loadFromProxiedUrl(trimmed);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't load that image.");
        setStatus("empty");
      }
    },
    [urlInput, loadFromProxiedUrl]
  );

  const handlePokemonSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const name = pokemonInput.trim();
      if (!name) return;
      setError(null);
      setStatus("loading");
      try {
        const res = await fetch(`/api/pokemon?name=${encodeURIComponent(name)}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || "Couldn't find that Pokémon.");
        }
        const { imageUrl } = await res.json();
        await loadFromProxiedUrl(imageUrl);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't find that Pokémon.");
        setStatus("empty");
      }
    },
    [pokemonInput, loadFromProxiedUrl]
  );

  const handleReset = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setEdgeMap(null);
    setOriginalUrl(null);
    setUrlInput("");
    setPokemonInput("");
    setError(null);
    setStatus("empty");
  }, []);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  useEffect(() => {
    if (!edgeMap) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = edgeMap.width;
    canvas.height = edgeMap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.putImageData(thresholdEdgeMap(edgeMap, sensitivity), 0, 0);
  }, [edgeMap, sensitivity]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  return (
    <div className="flex flex-1 flex-col bg-paper">
      <header className="mx-auto w-full max-w-5xl px-6 pt-10 pb-4 sm:px-8">
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          Colour It
        </h1>
        <p className="mt-2 max-w-md font-body text-ink-soft">
          Find a Pokémon, or use your own photo — get a black-and-white page, ready to print on
          A4 and colour in.
        </p>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 pb-16 sm:px-8">
        {status !== "ready" && (
          <div className="flex flex-1 items-center justify-center py-8">
            <div
              onDrop={onDrop}
              onDragOver={(e) => e.preventDefault()}
              className="w-full max-w-lg rounded-3xl border-2 border-dashed border-line bg-card p-8 text-center shadow-sm sm:p-10"
            >
              <p className="font-heading text-lg font-medium text-ink">Find a Pokémon</p>
              <p className="mt-1 text-sm text-ink-soft">Type a name or Pokédex number</p>

              <form onSubmit={handlePokemonSubmit} className="mt-5 flex gap-2">
                <label htmlFor="pokemon-name" className="sr-only">
                  Pokémon name or number
                </label>
                <input
                  id="pokemon-name"
                  type="text"
                  placeholder="Pikachu, Mewtwo, 150…"
                  value={pokemonInput}
                  disabled={status === "loading"}
                  onChange={(e) => setPokemonInput(e.target.value)}
                  className="min-h-11 flex-1 rounded-full border border-line bg-white px-4 text-sm text-ink placeholder:text-ink-soft/70 focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/30"
                />
                <button
                  type="submit"
                  disabled={status === "loading"}
                  className="min-h-11 rounded-full bg-coral px-5 font-body font-semibold text-white transition-colors hover:bg-coral-dark disabled:opacity-60"
                >
                  {status === "loading" ? "Working…" : "Find"}
                </button>
              </form>

              <div className="my-6 flex items-center gap-3 text-xs font-semibold tracking-wide text-ink-soft">
                <span className="h-px flex-1 bg-line" />
                or upload your own photo
                <span className="h-px flex-1 bg-line" />
              </div>

              <label className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-full border border-line px-6 font-body font-semibold text-ink transition-colors hover:bg-white">
                {status === "loading" ? "Working…" : "Choose photo"}
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  disabled={status === "loading"}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFile(file);
                    e.target.value = "";
                  }}
                />
              </label>

              <div className="my-6 flex items-center gap-3 text-xs font-semibold tracking-wide text-ink-soft">
                <span className="h-px flex-1 bg-line" />
                or paste an image link
                <span className="h-px flex-1 bg-line" />
              </div>

              <form onSubmit={handleUrlSubmit} className="flex gap-2">
                <label htmlFor="image-url" className="sr-only">
                  Image link
                </label>
                <input
                  id="image-url"
                  type="url"
                  inputMode="url"
                  placeholder="https://example.com/photo.jpg"
                  value={urlInput}
                  disabled={status === "loading"}
                  onChange={(e) => setUrlInput(e.target.value)}
                  className="min-h-11 flex-1 rounded-full border border-line bg-white px-4 text-sm text-ink placeholder:text-ink-soft/70 focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/30"
                />
                <button
                  type="submit"
                  disabled={status === "loading"}
                  className="min-h-11 rounded-full bg-blue px-5 font-body font-semibold text-white transition-colors hover:bg-blue/90 disabled:opacity-60"
                >
                  Use link
                </button>
              </form>

              {error && (
                <p className="mt-4 text-sm font-medium text-coral-dark" role="alert">
                  {error}
                </p>
              )}
            </div>
          </div>
        )}

        {status === "ready" && edgeMap && (
          <div className="grid flex-1 gap-8 py-6 lg:grid-cols-[280px_1fr]">
            <div className="flex flex-col gap-6">
              <div>
                <p className="mb-2 text-sm font-semibold text-ink-soft">Original image</p>
                {originalUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={originalUrl}
                    alt="Original image before conversion"
                    className="h-32 w-full rounded-2xl border border-line object-cover"
                  />
                )}
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between text-sm font-semibold text-ink-soft">
                  <span>Line detail</span>
                  <span>{sensitivity}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={sensitivity}
                  onChange={(e) => setSensitivity(Number(e.target.value))}
                  className="w-full accent-yellow"
                  aria-label="Line detail"
                />
                <div className="mt-1 flex justify-between text-xs text-ink-soft">
                  <span>Fewer lines</span>
                  <span>More lines</span>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="min-h-11 rounded-full bg-coral px-5 font-body font-semibold text-white transition-colors hover:bg-coral-dark"
                >
                  Print page (A4)
                </button>
                <button
                  type="button"
                  onClick={handleReset}
                  className="min-h-11 rounded-full border border-line px-5 font-body font-semibold text-ink transition-colors hover:bg-white"
                >
                  Use a different photo
                </button>
              </div>
            </div>

            <div className="flex items-center justify-center rounded-3xl border border-line bg-card p-4 sm:p-8">
              <div id="print-area">
                <canvas
                  ref={canvasRef}
                  className="max-h-[75vh] w-full max-w-full rounded-lg object-contain shadow-sm"
                />
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
