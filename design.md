# Design Documentation - Login Page

## Overview
Login page with animated finance-themed background and glass-morphism form card.

## UI Structure

### 1. Background Layer
- Full-screen canvas animation with:
  - Slow-moving color lines (6 lines in indigo/purple palette)
  - Floating financial numbers (£ amounts, percentages, ratings)
  - Animated bars/progress indicators (24 bars)
  - Moving blobs with radial gradients
  - Grid overlay
  - Shimmer effect
- SVG grain texture overlay at opacity 5%
- Dark radial gradient overlay

### 2. Form Card (Glassmorphism)
- **Container**: `glass-card` class with:
  - `rgba(255, 255, 255, 0.03)` background
  - `backdrop-filter: blur(20px)`
  - `1px solid rgba(255, 255, 255, 0.08)` border
  - Shadow: `0 20px 60px rgba(0, 0, 0, 0.5)`
  - Inset `0 1px 0 rgba(255, 255, 255, 0.05)`
  - `rounded-2xl` padding: `p-8 sm:p-10`

### 3. Form Elements

#### Header
- `h1`: "Credit Control Daily" - text-2xl font-bold text-white
- `p`: "Sign in to your account to continue" - text-sm text-zinc-500

#### Input Fields (Email & Password)
- Label: text-sm font-medium text-zinc-300
- Input container: relative with glowing border effect
  - Gradient: `from-indigo-500/50 to-purple-500/50`
  - Blur effect with transition on focus
- Input styles:
  - `h-11 w-full rounded-lg border border-white/10 bg-white`
  - `px-3.5 text-sm text-zinc-900 placeholder-zinc-400`
  - `backdrop-blur-sm transition-all duration-300`
  - Focus: `border-indigo-500/50`

#### Password Toggle
- Button positioned absolute right-3, vertically centered
- Shows/hides password with eye/slash icon
- SVG icons: 5x5 size
- `aria-label` dynamically set

#### Remember Me Toggle
- Horizontal switch component
- `role="switch"` with `aria-checked` binding
- Inner circle: `h-4 w-4 rounded-full bg-white shadow-sm`
- Moves `translate-x-6` when checked
- Border colors: 
  - Unchecked: `border-white/10 bg-white/[0.06]`
  - Checked: `border-indigo-500/50 bg-gradient-to-r from-indigo-600 to-purple-600`

#### Submit Button
- Gradient: `from-indigo-600 to-purple-600`
- `h-11 w-full rounded-lg`
- Text: `text-sm font-medium text-white`
- Hover: `shadow-[0_0_30px_rgba(99,102,241,0.5)]`
- Loading state: Spinner with "Signing in..."
- Disabled: `cursor-not-allowed opacity-70`

#### Links
- Terms & Privacy Policy links
- `text-zinc-500 underline-offset-2 transition-colors hover:text-zinc-300`

## UX Logic

### 1. Animation Behavior
- Canvas animations initialize on mount
- `initAnimations()` resets all animated elements on resize
- Resize handler debounces animation re-initialization
- Continuous `animate()` loop runs via `requestAnimationFrame`

### 2. Form State Management
- `showPassword`: toggle password visibility (state + SVG rendering)
- `rememberMe`: toggle remember me (switch animation)
- `isLoading`: disables button, shows spinner, 2s timeout

### 3. Input Validation
- Both fields are `required`
- Email: `type="email"` with `autoComplete="email"`
- Password: `type="password"` (or "text" when shown)
- Placeholder text provides examples

### 4. Interaction Flow
1. User visits page - canvas animations start
2. User focuses on email input - glow effect appears
3. User focuses on password input - glow effect appears
4. User toggles password visibility - icon changes
5. User toggles remember me - circle animates
6. User clicks submit:
   - Button disables
   - Loading spinner appears
   - 2-second delay simulates API call
   - Form resets to default state

### 5. Accessibility
- `aria-label` on password toggle (show/hide)
- `role="switch"` on remember me with `aria-checked`
- Focus visible styles on inputs
- Proper contrast ratios (dark background, light text)

## Color Palette
- Background: `#0a0a0f` (almost black)
- Card: `rgba(255, 255, 255, 0.03)` with blur
- Accent: Indigo/purple gradient (99, 102, 241 / 168, 85, 247)
- Text: zinc-900 (dark), zinc-500/zinc-300 (muted)
- Borders: `border-white/10` (subtle)

## Responsive Behavior
- Form card: `sm:p-10` (extra padding at sm breakpoint)
- Canvas: Full width via `w-full`, adjusts on window resize
- All animations re-initialize on resize