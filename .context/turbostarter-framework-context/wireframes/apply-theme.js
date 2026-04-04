#!/usr/bin/env node

/**
 * Excalidraw Theme Applicator
 *
 * This script applies color themes to Excalidraw wireframe files by replacing
 * color tokens (like $background, $primary, etc.) with actual hex values.
 *
 * Usage:
 *   node apply-theme.js <input.excalidraw> <theme-name> [output.excalidraw]
 *
 * Example:
 *   node apply-theme.js wireframe.excalidraw orange-light themed-wireframe.excalidraw
 *
 * The script expects a wireframe-themes.json file in the same directory with
 * the following structure:
 *
 * {
 *   "themes": {
 *     "orange-light": {
 *       "background": "#ffffff",
 *       "primary": "#f97316",
 *       "secondary": "#fed7aa",
 *       "accent": "#ea580c",
 *       "text": "#1f2937",
 *       "muted": "#9ca3af",
 *       "border": "#e5e7eb",
 *       "surface": "#f9fafb"
 *     },
 *     "blue-dark": {
 *       "background": "#0f172a",
 *       ...
 *     }
 *   }
 * }
 */

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SCRIPT_DIR = __dirname;
const THEMES_FILE = path.join(SCRIPT_DIR, "wireframe-themes.json");

// Color properties to search for in Excalidraw elements
const COLOR_PROPERTIES = ["strokeColor", "backgroundColor"];

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

/**
 * Load and parse the themes configuration file
 * @returns {Object} The themes configuration object
 */
function loadThemes() {
  if (!fs.existsSync(THEMES_FILE)) {
    console.error(`Error: Themes file not found at ${THEMES_FILE}`);
    console.error("\nPlease create a wireframe-themes.json file with the following structure:");
    console.error(`
{
  "themes": {
    "theme-name": {
      "background": "#ffffff",
      "primary": "#f97316",
      "secondary": "#fed7aa",
      "accent": "#ea580c",
      "text": "#1f2937",
      "muted": "#9ca3af",
      "border": "#e5e7eb",
      "surface": "#f9fafb"
    }
  }
}
`);
    process.exit(1);
  }

  try {
    const content = fs.readFileSync(THEMES_FILE, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    console.error(`Error: Failed to parse themes file: ${error.message}`);
    process.exit(1);
  }
}

/**
 * List all available themes from the configuration
 * @param {Object} themesConfig - The themes configuration object
 */
function listAvailableThemes(themesConfig) {
  const themes = Object.keys(themesConfig.themes || {});

  if (themes.length === 0) {
    console.error("No themes found in wireframe-themes.json");
    return;
  }

  console.log("\nAvailable themes:");
  themes.forEach((theme) => {
    console.log(`  - ${theme}`);
  });
  console.log("");
}

/**
 * Replace a color token with the corresponding theme color
 * @param {string} value - The color value (may be a token like "$primary")
 * @param {Object} themeColors - The color mapping for the selected theme
 * @returns {string} The resolved hex color or the original value if not a token
 */
function resolveColorToken(value, themeColors) {
  // Check if the value is a color token (starts with $)
  if (typeof value !== "string" || !value.startsWith("$")) {
    return value;
  }

  // Extract the token name (remove the $ prefix)
  const tokenName = value.substring(1);

  // Look up the color in the theme
  if (themeColors.hasOwnProperty(tokenName)) {
    return themeColors[tokenName];
  }

  // Token not found in theme - warn but keep original
  console.warn(`Warning: Color token "${value}" not found in theme`);
  return value;
}

/**
 * Recursively process an element and its children, replacing color tokens
 * @param {Object} element - An Excalidraw element
 * @param {Object} themeColors - The color mapping for the selected theme
 * @param {Object} stats - Statistics object to track replacements
 * @returns {Object} The element with colors replaced
 */
function processElement(element, themeColors, stats) {
  if (!element || typeof element !== "object") {
    return element;
  }

  // Handle arrays (like the elements array or grouped elements)
  if (Array.isArray(element)) {
    return element.map((item) => processElement(item, themeColors, stats));
  }

  // Process the current object
  const processed = { ...element };

  // Check and replace color properties
  for (const prop of COLOR_PROPERTIES) {
    if (processed.hasOwnProperty(prop) && typeof processed[prop] === "string") {
      const originalValue = processed[prop];
      const newValue = resolveColorToken(originalValue, themeColors);

      if (originalValue !== newValue) {
        processed[prop] = newValue;
        stats.replacements++;
        stats.details.push({
          property: prop,
          from: originalValue,
          to: newValue,
        });
      }
    }
  }

  // Recursively process nested objects and arrays
  for (const key of Object.keys(processed)) {
    if (typeof processed[key] === "object" && processed[key] !== null) {
      processed[key] = processElement(processed[key], themeColors, stats);
    }
  }

  return processed;
}

/**
 * Generate a default output filename based on input and theme
 * @param {string} inputFile - The input file path
 * @param {string} themeName - The theme name
 * @returns {string} The generated output file path
 */
function generateOutputFilename(inputFile, themeName) {
  const dir = path.dirname(inputFile);
  const ext = path.extname(inputFile);
  const base = path.basename(inputFile, ext);

  return path.join(dir, `${base}-${themeName}${ext}`);
}

/**
 * Display usage information
 */
function showUsage() {
  console.log(`
Excalidraw Theme Applicator

Usage:
  node apply-theme.js <input.excalidraw> <theme-name> [output.excalidraw]

Arguments:
  input.excalidraw   - Path to the input Excalidraw JSON file
  theme-name         - Name of the theme to apply
  output.excalidraw  - Optional output file path (default: input-themename.excalidraw)

Examples:
  node apply-theme.js wireframe.excalidraw orange-light
  node apply-theme.js wireframe.excalidraw blue-dark themed-wireframe.excalidraw

Color Tokens:
  The script replaces tokens like $background, $primary, etc. in strokeColor
  and backgroundColor properties with hex values from the selected theme.
`);
}

// ---------------------------------------------------------------------------
// Main Script
// ---------------------------------------------------------------------------

function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);

  if (args.length < 2) {
    showUsage();

    // Try to show available themes if the file exists
    if (fs.existsSync(THEMES_FILE)) {
      const themesConfig = loadThemes();
      listAvailableThemes(themesConfig);
    }

    process.exit(1);
  }

  const inputFile = args[0];
  const themeName = args[1];
  const outputFile = args[2] || generateOutputFilename(inputFile, themeName);

  // Validate input file exists
  if (!fs.existsSync(inputFile)) {
    console.error(`Error: Input file not found: ${inputFile}`);
    process.exit(1);
  }

  // Load themes configuration
  const themesConfig = loadThemes();

  // Validate theme exists
  if (!themesConfig.themes || !themesConfig.themes[themeName]) {
    console.error(`Error: Theme "${themeName}" not found`);
    listAvailableThemes(themesConfig);
    process.exit(1);
  }

  const themeColors = themesConfig.themes[themeName];

  // Load and parse the Excalidraw file
  let excalidrawData;
  try {
    const content = fs.readFileSync(inputFile, "utf-8");
    excalidrawData = JSON.parse(content);
  } catch (error) {
    console.error(`Error: Failed to parse input file: ${error.message}`);
    process.exit(1);
  }

  // Track statistics
  const stats = {
    replacements: 0,
    details: [],
  };

  // Process the Excalidraw data
  console.log(`Applying theme "${themeName}" to ${inputFile}...`);

  const themedData = processElement(excalidrawData, themeColors, stats);

  // Write the output file
  try {
    const outputContent = JSON.stringify(themedData, null, 2);
    fs.writeFileSync(outputFile, outputContent, "utf-8");
  } catch (error) {
    console.error(`Error: Failed to write output file: ${error.message}`);
    process.exit(1);
  }

  // Report results
  console.log(`\nTheme applied successfully!`);
  console.log(`  Input:  ${inputFile}`);
  console.log(`  Output: ${outputFile}`);
  console.log(`  Theme:  ${themeName}`);
  console.log(`  Replacements: ${stats.replacements}`);

  if (stats.replacements > 0 && args.includes("--verbose")) {
    console.log("\nDetails:");
    stats.details.forEach((detail) => {
      console.log(`  ${detail.property}: ${detail.from} -> ${detail.to}`);
    });
  }
}

// Run the script
main();
