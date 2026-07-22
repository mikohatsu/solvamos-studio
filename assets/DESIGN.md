---
name: SolVamos Studio
colors:
  surface: '#081425'
  surface-dim: '#081425'
  surface-bright: '#2f3a4c'
  surface-container-lowest: '#040e1f'
  surface-container-low: '#111c2d'
  surface-container: '#152031'
  surface-container-high: '#1f2a3c'
  surface-container-highest: '#2a3548'
  on-surface: '#d8e3fb'
  on-surface-variant: '#c2c6d5'
  inverse-surface: '#d8e3fb'
  inverse-on-surface: '#263143'
  outline: '#8c909f'
  outline-variant: '#424753'
  surface-tint: '#adc6ff'
  primary: '#adc6ff'
  on-primary: '#002e69'
  primary-container: '#4d8efe'
  on-primary-container: '#00285c'
  inverse-primary: '#005ac1'
  secondary: '#a0ffc3'
  on-secondary: '#00391f'
  secondary-container: '#00ec91'
  on-secondary-container: '#00653b'
  tertiary: '#bec6e0'
  on-tertiary: '#283044'
  tertiary-container: '#8990a8'
  on-tertiary-container: '#22293d'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#d8e2ff'
  primary-fixed-dim: '#adc6ff'
  on-primary-fixed: '#001a41'
  on-primary-fixed-variant: '#004494'
  secondary-fixed: '#56ffa8'
  secondary-fixed-dim: '#00e38b'
  on-secondary-fixed: '#002110'
  on-secondary-fixed-variant: '#00522f'
  tertiary-fixed: '#dae2fd'
  tertiary-fixed-dim: '#bec6e0'
  on-tertiary-fixed: '#131b2e'
  on-tertiary-fixed-variant: '#3f465c'
  background: '#081425'
  on-background: '#d8e3fb'
  surface-variant: '#2a3548'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 48px
    fontWeight: '700'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '600'
    lineHeight: '1.3'
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.3'
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.4'
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: '1.6'
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
  label-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '500'
    lineHeight: '1.2'
    letterSpacing: 0.01em
  label-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: '1.2'
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 4px
  xs: 0.25rem
  sm: 0.5rem
  md: 1rem
  lg: 1.5rem
  xl: 2rem
  xxl: 4rem
  container-max: 1440px
  gutter: 24px
  margin-mobile: 16px
---

## Brand & Style

The design system is engineered for a high-performance B2B SaaS environment, blending the precision of developer tools with the fluidity of modern web3 aesthetics. The brand personality is **technical, sophisticated, and reliable**, targeting professional teams who require a high-density information environment that doesn't sacrifice visual elegance.

The visual style is a hybrid of **Minimalism** and **Glassmorphism**. It prioritizes deep, immersive backgrounds to reduce eye strain during long-form work sessions, while using vibrant accents to indicate action and progress. Every interface element is designed to feel like a high-end physical console—precise, responsive, and tactile through the use of subtle gradients and high-contrast borders.

## Colors

The palette is optimized for a **high-tech dark mode** experience. 

- **Foundation:** The primary background uses Deep Slate (#0F172A) to provide a rich, non-distracting canvas. Surfaces and cards use Slate Gray (#1E293B) to create clear structural hierarchy.
- **Accents:** Google Blue (#4285F4) is the primary action color, used for CTA buttons and primary navigational states. Solana Green (#14F195) is reserved for success states, growth metrics, and active progress indicators, providing a high-energy contrast against the dark base.
- **Accessibility:** Text hierarchy is strictly enforced with Pure White for headings and Slate-400 (#94A3B8) for secondary body copy to ensure readability and reduce visual noise.

## Typography

This design system utilizes **Inter** as its sole typeface, chosen for its exceptional legibility in both English and Korean (Hangul) scripts. The typeface's tall x-height and geometric clarity make it ideal for data-heavy SaaS interfaces.

- **Scale:** A tight typographic scale ensures that information density remains high without feeling cluttered.
- **Korean Optimization:** For Korean text, line-height is increased by roughly 10% compared to standard English settings to prevent character crowding. 
- **Hierarchy:** Bold weights are used sparingly for navigation and headers, while Medium (500) is preferred for interactive labels to maintain a sleek, professional aesthetic.

## Layout & Spacing

The design system employs a **12-column fluid grid** for desktop, transitioning to a **4-column grid** for mobile. 

- **Grid Logic:** A 4px baseline grid governs all spacing, ensuring rhythmic consistency. 
- **Margins & Gutters:** Desktop layouts use 24px gutters to allow the UI to "breathe" amidst complex data sets. 
- **Sidebars:** Primary navigation is housed in a fixed 280px left-hand sidebar, while secondary contextual panels use a slide-over "drawer" model to maintain focus on the central workspace.

## Elevation & Depth

Depth is conveyed through **Tonal Layering** and **Glassmorphism** rather than traditional heavy shadows.

- **Surface Tiers:** Background is the lowest level (#0F172A). Content cards sit on the next level (#1E293B) with a subtle 1px border (White at 10% opacity).
- **Glass Effects:** Interactive "floating" elements like chat previews or tooltips use a background blur (20px) and semi-transparent fills (White at 5% opacity). This creates a sense of "lightness" and allows the background colors to peak through.
- **Interactive Depth:** On hover, cards should slightly increase in brightness and the border opacity should double to 20% to signal interactivity.

## Shapes

The design system uses a **Rounded (Level 2)** shape language to soften the "industrial" feel of the dark theme.

- **Standard Radius:** Components like buttons and inputs use a 0.5rem (8px) radius.
- **Container Radius:** Large surface areas like cards and modals use 1rem (16px) for a modern, friendly feel.
- **Consistency:** All nested elements must have a corner radius that is 4px smaller than their parent container to maintain visual harmony.

## Components

### Buttons
- **Primary:** Solid #4285F4 with white text. Hover state adds a subtle outer glow of the same color (20% opacity).
- **Secondary:** Transparent background with a 1px border of #4285F4. Hover state fills the background at 10% opacity.
- **Success:** Solid #14F195 with #0F172A text for maximum contrast.

### Input Fields
- Dark backgrounds (#0F172A) with a subtle 1px border. Focus state triggers a #4285F4 border color and a soft blue outer glow.

### Step-by-Step Progress Indicators
- Linear horizontal dots for desktop, vertical for mobile. Completed steps use the Solana Green (#14F195) with a checkmark icon. The active step features a pulsing ring animation.

### Glassmorphism Chat Preview
- Background: `rgba(255, 255, 255, 0.05)`.
- Backdrop Blur: `24px`.
- Border: `1px solid rgba(255, 255, 255, 0.1)`.
- Chat bubbles for the user use #4285F4; system/AI bubbles use the glass effect for distinction.

### Chips & Badges
- Used for status indicators. High-saturation colors (#14F195 for "Active", #4285F4 for "Processing") with 10% opacity fills and 100% opacity text for a "neon-on-dark" look.