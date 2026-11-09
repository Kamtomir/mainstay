"use client";

import { useState } from "react";
import { highlightTags } from "@/lib/highlight";
import { formatCount } from "../lib/format";

export function Search({ total }: { total: number }) {
  const [query, setQuery] = useState("");
  async function onYear(text: string) {
    const { parseYear } = await import("../lib/dates");
    return parseYear(text);
  }
  return (
    <div onBlur={() => onYear(query)}>
      <input value={query} onChange={(e) => setQuery(e.target.value)} />
      <p dangerouslySetInnerHTML={{ __html: highlightTags(query) }} />
      <small>{formatCount(total)}</small>
    </div>
  );
}
