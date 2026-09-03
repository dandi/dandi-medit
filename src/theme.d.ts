import '@mui/material/styles';

// MUI's palette colors have no `lighter` shade, but the theme in App.tsx
// defines one and components reference it through the `sx` prop.
declare module '@mui/material/styles' {
  interface PaletteColor {
    lighter?: string;
  }

  interface SimplePaletteColorOptions {
    lighter?: string;
  }
}
