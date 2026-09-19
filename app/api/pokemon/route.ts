import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const FETCH_TIMEOUT_MS = 8_000;

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface PokeApiSprites {
  front_default: string | null;
  other?: {
    "official-artwork"?: { front_default: string | null };
    home?: { front_default: string | null };
  };
}

export async function GET(request: NextRequest) {
  const rawName = request.nextUrl.searchParams.get("name") ?? "";
  const slug = slugify(rawName);
  if (!slug) {
    return NextResponse.json({ error: "Type a Pokémon name or number" }, { status: 400 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`https://pokeapi.co/api/v2/pokemon/${encodeURIComponent(slug)}`, {
      signal: controller.signal,
    });
  } catch {
    clearTimeout(timeout);
    return NextResponse.json({ error: "Couldn't reach the Pokémon database" }, { status: 502 });
  }
  clearTimeout(timeout);

  if (response.status === 404) {
    return NextResponse.json(
      { error: `No Pokémon found named "${rawName.trim()}". Check the spelling or try its number.` },
      { status: 404 }
    );
  }
  if (!response.ok) {
    return NextResponse.json({ error: "Couldn't reach the Pokémon database" }, { status: 502 });
  }

  const data: { id: number; name: string; sprites: PokeApiSprites } = await response.json();
  const imageUrl =
    data.sprites.other?.["official-artwork"]?.front_default ||
    data.sprites.other?.home?.front_default ||
    data.sprites.front_default;

  if (!imageUrl) {
    return NextResponse.json({ error: "That Pokémon doesn't have artwork available" }, { status: 404 });
  }

  return NextResponse.json({
    id: data.id,
    name: data.name,
    imageUrl,
  });
}
