/** Surface and text tokens for the dark line-up UI. Text tones all clear 4.5:1 on `bg`. */
export const Ink = {
  bg: '#09090E',
  raised: '#13131C',
  line: '#2A2A3C',
  text: '#F4F4F8',
  textDim: '#A6A6BC',
  textFaint: '#7E7E96',
};

/** Text shadow that keeps type readable when it sits over the bright chrome chains. */
export const Legible = {
  textShadowColor: 'rgba(0,0,0,0.9)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 8,
} as const;
