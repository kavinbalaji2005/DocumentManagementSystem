import fs from "fs";
import path from "path";
import process from "node:process";

const components = [
  "button",
  "dialog",
  "input",
  "label",
  "scroll-area",
  "separator",
  "toast",
  "toaster",
  "use-toast",
  "tabs",
  "dropdown-menu",
  "context-menu",
  "alert-dialog",
];

const UI_DIR = path.join(process.cwd(), "src", "components", "ui");
const HOOKS_DIR = path.join(process.cwd(), "src", "hooks");
const LIB_DIR = path.join(process.cwd(), "src", "lib");

[UI_DIR, HOOKS_DIR, LIB_DIR].forEach((dir) =>
  fs.mkdirSync(dir, { recursive: true }),
);

// utils.js for lib
fs.writeFileSync(
  path.join(LIB_DIR, "utils.js"),
  'import { clsx } from "clsx";\\nimport { twMerge } from "tailwind-merge";\\nexport function cn(...inputs) {\\n  return twMerge(clsx(inputs));\\n}\\n',
);

async function fetchComponent(name) {
  try {
    const res = await fetch(
      "https://ui.shadcn.com/registry/styles/default/" + name + ".json",
    );
    const data = await res.json();

    for (const file of data.files) {
      const fileName = file.name || file.path;
      const content = file.content;
      let targetPath;

      targetPath = path.join(UI_DIR, fileName);
      if (fileName === "use-toast.ts") {
        targetPath = path.join(HOOKS_DIR, "use-toast.ts");
      }

      fs.writeFileSync(targetPath, content);
      console.log("Saved " + targetPath);
    }

    if (data.dependencies) {
      console.log("To install: npm i " + data.dependencies.join(" "));
    }
  } catch (e) {
    console.error("Failed " + name + ": " + e.message);
  }
}

async function run() {
  for (const c of components) {
    await fetchComponent(c);
  }
}

run();
