import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Material UI
import { createTheme, ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';

// -----------------------------
// Thème "Apple-like" unifié
// -----------------------------
const appleTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#007AFF', // Couleur iOS
    },
    secondary: {
      main: '#5856D6', // Autre teinte iOS
    },
    background: {
      default: '#1C1C1E', // Fond sombre type iOS
      paper: '#2C2C2E',   // Panneaux
    },
    text: {
      primary: '#FFFFFF',
      secondary: '#B3B3B3',
    },
  },
  typography: {
    fontFamily: [
      'Helvetica Neue',
      'Roboto',
      'Arial',
      'sans-serif',
    ].join(','),
    h6: {
      fontWeight: 600,
    },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          // Fond dégradé façon Apple
          background: 'linear-gradient(135deg, #1C1C1E 0%, #2C2C2E 100%)',
          margin: 0,
          padding: 0,
          WebkitFontSmoothing: 'antialiased',
          MozOsxFontSmoothing: 'grayscale',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          borderRadius: 12,
          ':hover': {
            boxShadow: '0 0 10px rgba(0,0,0,0.2)',
          },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundColor: 'rgba(44, 44, 46, 0.75)', // effet vitre
          backdropFilter: 'blur(8px)',
        },
      },
    },
  },
});

// ------------------------------------
//  Rendu final
// ------------------------------------
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <ThemeProvider theme={appleTheme}>
    <CssBaseline />
    <App />
  </ThemeProvider>
);
