// Struck sounds lose their upper partials first. Each table gives a layer a few
// partials, each with its own level (gains) and its own, shorter life (life, as a
// fraction of the note). Ratios above 1 that are not whole numbers (2.76, 5.4...)
// are what makes bronze sound like bronze rather than like an organ.

export const TIMBRES = {
  glass:     { ratios: [1, 2.0, 3.0, 4.01],   gains: [1, 0.17, 0.07, 0.025], life: [1, 0.55, 0.34, 0.22] },
  felt:      { ratios: [1, 2.0, 3.0, 4.02],   gains: [1, 0.20, 0.08, 0.03],  life: [1, 0.45, 0.28, 0.18] },
  bell:      { ratios: [1, 2.005, 2.99, 4.21], gains: [1, 0.30, 0.12, 0.045], life: [1, 0.70, 0.50, 0.32] },
  velvet:    { ratios: [1, 2.0, 3.01],        gains: [1, 0.14, 0.05],         life: [1, 0.55, 0.35] },
  celesta:   { ratios: [1, 2.01, 3.0, 5.02],  gains: [1, 0.13, 0.08, 0.03],   life: [1, 0.50, 0.35, 0.20] },
  warmglass: { ratios: [1, 2.0, 3.0],         gains: [1, 0.18, 0.06],         life: [1, 0.70, 0.50] },
  gamelan:   { ratios: [1, 2.76, 5.4],        gains: [1, 0.26, 0.09],         life: [1, 0.55, 0.32] },
  bassbell:  { ratios: [1, 2.76, 5.4],        gains: [1, 0.22, 0.07],         life: [1, 0.55, 0.32] },
};

// The tiny noise that comes with a touch: felt on a string, a fingertip on glass.
// center is a multiple of the note's pitch; level is relative to the note's peak.
export const HAMMER = {
  felt:    { center: 2.2, q: 0.9, level: 0.30, seconds: 0.07 },
  velvet:  { center: 2.6, q: 1.0, level: 0.26, seconds: 0.05 },
  celesta: { center: 3.2, q: 1.2, level: 0.22, seconds: 0.04 },
  glass:   { center: 3.0, q: 1.2, level: 0.14, seconds: 0.05 },
  bell:    { center: 3.4, q: 1.4, level: 0.10, seconds: 0.03 },
};
