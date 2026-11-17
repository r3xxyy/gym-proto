import { useCallback } from 'react';
import { TextInput } from 'react-native';
import type { TextInputFocusEvent, TextInputProps } from 'react-native';
import { useBottomSheetInternal } from '@gorhom/bottom-sheet';

/**
 * Stand-in for gorhom's BottomSheetTextInput. That one imports `TextInput` from
 * react-native-gesture-handler, which v3 no longer exports, so it renders undefined and the whole
 * sheet fails. This does the same keyboard handoff with the plain RN input.
 */
export function SheetTextInput({ onFocus, onBlur, ...rest }: TextInputProps) {
  const { animatedKeyboardState } = useBottomSheetInternal();

  const handleFocus = useCallback((e: TextInputFocusEvent) => {
    animatedKeyboardState.set(state => ({ ...state, target: e.nativeEvent.target }));
    onFocus?.(e);
  }, [onFocus, animatedKeyboardState]);

  const handleBlur = useCallback((e: TextInputFocusEvent) => {
    if (animatedKeyboardState.get().target === e.nativeEvent.target) {
      animatedKeyboardState.set(state => ({ ...state, target: undefined }));
    }
    onBlur?.(e);
  }, [onBlur, animatedKeyboardState]);

  return <TextInput onFocus={handleFocus} onBlur={handleBlur} {...rest} />;
}
