import assert from "node:assert/strict";
import { test } from "node:test";
import { isBaseQvUrl, isSameSupabaseProject } from "../../lib/env.mjs";

test("recusa BASE QV como destino do catálogo", () => {
  assert.equal(
    isSameSupabaseProject(
      "https://lacinxsvjdwalkchxyeo.supabase.co",
      "https://lacinxsvjdwalkchxyeo.supabase.co",
    ),
    true,
  );
  assert.equal(
    isSameSupabaseProject(
      "https://rckpuebaiswrxzmywllv.supabase.co",
      "https://lacinxsvjdwalkchxyeo.supabase.co",
    ),
    false,
  );
});

test("reconhece a URL da BASE QV", () => {
  assert.equal(isBaseQvUrl("https://lacinxsvjdwalkchxyeo.supabase.co"), true);
  assert.equal(isBaseQvUrl("https://rckpuebaiswrxzmywllv.supabase.co"), false);
});
