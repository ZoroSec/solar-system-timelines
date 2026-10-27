/* Export the authored chapters as JSON so the data tests can compare the
   presentation layer with the published dataset. */

import { readFileSync, writeFileSync } from "node:fs";
import { PLANET_ORDER, PLANETS } from "../planet-eras.js";
import { EARTH_ERAS } from "../earth-eras.js";

const worlds = PLANET_ORDER.map((key) => {
  const world = PLANETS[key];
  const chapters = key === "earth" ? EARTH_ERAS : world.chapters;
  return {
    key,
    name: world.name,
    type: key === "earth" ? "earth" : world.type,
    headline: world.headline,
    startShort: world.startShort,
    credit: world.credit,
    ringStyle: world.ringStyle ?? 0,
    chapters: chapters.map((chapter, index) => ({
      index,
      at: chapter.at,
      time: chapter.time,
      event: chapter.event,
      note: chapter.note,
    })),
  };
});

const output = {
  schemaVersion: 1,
  presentYear: 2026,
  worlds,
};

const target = process.argv[2];
const json = JSON.stringify(output, null, 2) + "\n";
if (target === "--check") {
  const committed = readFileSync(new URL("../data/js-events.json", import.meta.url), "utf8");
  if (committed !== json) {
    console.error(
      "data/js-events.json is stale; run node tools/export_events.mjs data/js-events.json"
    );
    process.exit(1);
  }
  console.log("data/js-events.json is current");
} else if (target) {
  writeFileSync(target, json, "utf8");
  console.error(`wrote ${target}`);
} else {
  process.stdout.write(json);
}
