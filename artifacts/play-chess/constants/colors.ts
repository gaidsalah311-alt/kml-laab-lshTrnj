/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const colors = {
  light: {
    text: '#14211d',
    tint: '#c38b45',
    background: '#f6f2e9',
    foreground: '#14211d',
    card: '#fffdf8',
    cardForeground: '#14211d',
    primary: '#173b36',
    primaryForeground: '#fffdf8',
    secondary: '#e8eee8',
    secondaryForeground: '#173b36',
    muted: '#e7e3d8',
    mutedForeground: '#6a746e',
    accent: '#e1b56c',
    accentForeground: '#173b36',
    destructive: '#b9574d',
    destructiveForeground: '#fffdf8',
    border: '#d8d5c9',
    input: '#d8d5c9',
    boardLight: '#e8dfc9',
    boardDark: '#54766a',
    boardHighlight: '#e1b56c',
    boardLastMove: '#c9d39a',
    success: '#4e8468',
    pieceWhite: '#fffaf0',
    pieceBlack: '#183630',
    onPrimaryMuted: '#c7d8cd',
  },

  dark: {
    text: '#f5f1e8',
    tint: '#e1b56c',
    background: '#101d1a',
    foreground: '#f5f1e8',
    card: '#172a25',
    cardForeground: '#f5f1e8',
    primary: '#d7e4d2',
    primaryForeground: '#173b36',
    secondary: '#233d35',
    secondaryForeground: '#eaf2e7',
    muted: '#263b35',
    mutedForeground: '#a4b1a9',
    accent: '#e1b56c',
    accentForeground: '#173b36',
    destructive: '#e2776d',
    destructiveForeground: '#fffdf8',
    border: '#345148',
    input: '#345148',
    boardLight: '#a8b899',
    boardDark: '#31594d',
    boardHighlight: '#e1b56c',
    boardLastMove: '#6e8c64',
    success: '#80b995',
    pieceWhite: '#fffaf0',
    pieceBlack: '#183630',
    onPrimaryMuted: '#c7d8cd',
  },

  radius: 16,
};

export default colors;
