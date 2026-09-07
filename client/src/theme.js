import { createTheme, rem } from '@mantine/core';

/**
 * A warm, biscuit-toned design system: amber primary, slate neutrals,
 * generous radii and soft shadows. Everything else in the app pulls its
 * colours from here so light and dark stay consistent.
 */
export const theme = createTheme({
  primaryColor: 'biscuit',
  primaryShade: { light: 6, dark: 5 },
  defaultRadius: 'md',
  fontFamily: 'Inter, -apple-system, Segoe UI, Roboto, sans-serif',
  fontFamilyMonospace: 'JetBrains Mono, ui-monospace, SFMono-Regular, monospace',
  headings: {
    fontFamily: 'Inter, -apple-system, Segoe UI, sans-serif',
    fontWeight: '700',
    sizes: {
      h1: { fontSize: rem(28), lineHeight: '1.25' },
      h2: { fontSize: rem(21), lineHeight: '1.3' },
      h3: { fontSize: rem(17), lineHeight: '1.35' },
      h4: { fontSize: rem(15), lineHeight: '1.4' },
    },
  },
  colors: {
    biscuit: [
      '#fdf7ed',
      '#f7ead4',
      '#efd3a5',
      '#e6bb72',
      '#dfa648',
      '#db992d',
      '#d99321',
      '#c07f18',
      '#ab7011',
      '#956005',
    ],
    cocoa: [
      '#f6f2ef',
      '#e7e0da',
      '#cdbeb2',
      '#b39a88',
      '#9d7c65',
      '#916a4f',
      '#8c6144',
      '#785036',
      '#6c462d',
      '#5f3a22',
    ],
    slate: [
      '#f4f6f9',
      '#e7ebf0',
      '#cbd4de',
      '#adbccc',
      '#94a7bd',
      '#8399b3',
      '#7a92ae',
      '#687e99',
      '#5b708a',
      '#4b617b',
    ],
  },
  shadows: {
    xs: '0 1px 2px rgba(16, 24, 40, 0.05)',
    sm: '0 1px 3px rgba(16, 24, 40, 0.08), 0 1px 2px rgba(16, 24, 40, 0.04)',
    md: '0 4px 12px rgba(16, 24, 40, 0.08), 0 2px 4px rgba(16, 24, 40, 0.04)',
    lg: '0 12px 28px rgba(16, 24, 40, 0.10), 0 4px 8px rgba(16, 24, 40, 0.04)',
    xl: '0 24px 48px rgba(16, 24, 40, 0.14)',
  },
  components: {
    Card: { defaultProps: { radius: 'lg', withBorder: true, shadow: 'xs' } },
    Paper: { defaultProps: { radius: 'lg' } },
    Button: { defaultProps: { radius: 'md', fw: 600 } },
    Badge: { defaultProps: { radius: 'sm', fw: 600 } },
    Table: { defaultProps: { verticalSpacing: 'xs', horizontalSpacing: 'md', highlightOnHover: true } },
    Modal: { defaultProps: { radius: 'lg', centered: true, overlayProps: { blur: 3, backgroundOpacity: 0.45 } } },
    TextInput: { defaultProps: { radius: 'md' } },
    NumberInput: { defaultProps: { radius: 'md' } },
    Select: { defaultProps: { radius: 'md' } },
    Tooltip: { defaultProps: { radius: 'sm', withArrow: true, openDelay: 300 } },
  },
});

/** Status -> Mantine colour, used everywhere a badge is drawn. */
export const STATUS_COLORS = {
  DRAFT: 'gray',
  PENDING_APPROVAL: 'yellow',
  APPROVED: 'teal',
  REJECTED: 'red',
  ARCHIVED: 'dark',
  RELEASED: 'blue',
  IN_PROGRESS: 'indigo',
  COMPLETED: 'teal',
  CANCELLED: 'red',
  POSTED: 'teal',
  REVERSED: 'orange',
  FAVOURABLE: 'teal',
  ADVERSE: 'red',
  ON_STANDARD: 'gray',
  PAYABLE: 'orange',
  REFUNDABLE: 'teal',
  NIL: 'gray',
};
