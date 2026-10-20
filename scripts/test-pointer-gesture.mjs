import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/panel/pointerGesture.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext },
}).outputText;
const { trackPointerGesture } = await import(
  `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`
);

function setup() {
  const windowTarget = new EventTarget();
  const documentTarget = new EventTarget();
  documentTarget.hidden = false;
  globalThis.window = windowTarget;
  globalThis.document = documentTarget;
  const finishes = [];
  let moves = 0;
  const cleanup = trackPointerGesture(7, () => moves++, (cancelled) => finishes.push(cancelled));
  const pointer = (type, id = 7) => {
    const e = new Event(type);
    Object.defineProperty(e, "pointerId", { value: id });
    windowTarget.dispatchEvent(e);
  };
  return { windowTarget, documentTarget, finishes, cleanup, pointer, moves: () => moves };
}

{
  const s = setup();
  s.pointer("pointermove", 8);
  s.pointer("pointerup", 8);
  assert.equal(s.moves(), 0);
  assert.deepEqual(s.finishes, []);
  s.pointer("pointermove");
  s.pointer("pointerup");
  s.pointer("pointermove");
  s.windowTarget.dispatchEvent(new Event("blur"));
  assert.equal(s.moves(), 1);
  assert.deepEqual(s.finishes, [false]);
}
for (const reason of ["pointercancel", "blur", "hidden"]) {
  const s = setup();
  if (reason === "hidden") {
    s.documentTarget.dispatchEvent(new Event("visibilitychange"));
    assert.deepEqual(s.finishes, []);
    s.documentTarget.hidden = true;
    s.documentTarget.dispatchEvent(new Event("visibilitychange"));
  } else if (reason === "blur") {
    s.windowTarget.dispatchEvent(new Event("blur"));
  } else {
    s.pointer("pointercancel", 8);
    assert.deepEqual(s.finishes, []);
    s.pointer("pointercancel");
  }
  s.pointer("pointerup");
  s.pointer("pointermove");
  assert.deepEqual(s.finishes, [true]);
  assert.equal(s.moves(), 0);
}
{
  const s = setup();
  s.cleanup();
  s.cleanup();
  s.pointer("pointermove");
  s.pointer("pointerup");
  s.windowTarget.dispatchEvent(new Event("blur"));
  assert.deepEqual(s.finishes, []);
  assert.equal(s.moves(), 0);
}
console.log("Pointer lifecycle tests passed (normal release, pointer ownership, cancel, blur, hidden, cleanup)");
