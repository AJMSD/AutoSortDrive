import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '@/App';
import '@/styles/globals.css';

// Set theme before React renders to avoid flash
const storedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null;
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
const theme = storedTheme || (prefersDark ? 'dark' : 'dark'); // Default to dark
document.documentElement.setAttribute('data-theme', theme);
document.body.setAttribute('data-theme', theme);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
