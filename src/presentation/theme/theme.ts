import { createTheme, MantineColorsTuple } from '@mantine/core';

const cadBrand: MantineColorsTuple = [
  '#f1f3f5',
  '#e9ecef',
  '#dee2e6',
  '#ced4da',
  '#adb5bd',
  '#868e96',
  '#495057',
  '#343a40',
  '#212529',
  '#121416'
];

export const theme = createTheme({
  primaryColor: 'dark',
  colors: {
    cadBrand,
  },
  fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif',
  fontFamilyMonospace: 'JetBrains Mono, Menlo, monospace',
  defaultRadius: 'sm',
  cursorType: 'pointer',
});
