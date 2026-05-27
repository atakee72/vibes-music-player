import { useEffect, useState } from 'react';
import { extractDominantColor } from '../lib/colors';

export function useDominantColor(imageUrl: string | undefined): string | null {
  const [color, setColor] = useState<string | null>(null);

  useEffect(() => {
    if (!imageUrl) {
      setColor(null);
      return;
    }
    let aborted = false;
    extractDominantColor(imageUrl).then((c) => {
      if (!aborted) setColor(c);
    });
    return () => {
      aborted = true;
    };
  }, [imageUrl]);

  return color;
}
