import { View } from 'react-native';

/**
 * Play triangle, pointing right in LTR and RTL alike (media controls don't mirror). Drawn as an
 * up-pointing border triangle rotated 90 degrees, because left/right borders swap under RTL.
 */
export function PlayIcon({ color, size = 16 }: { color: string; size?: number }) {
  const base = size * 0.9;
  const tall = size * 0.8;
  return (
    // Nudged right: a triangle's optical centre sits left of its box centre.
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center', transform: [{ translateX: size * 0.08 }] }}>
      <View
        style={{
          width: 0,
          height: 0,
          borderLeftWidth: base / 2,
          borderRightWidth: base / 2,
          borderBottomWidth: tall,
          borderLeftColor: 'transparent',
          borderRightColor: 'transparent',
          borderBottomColor: color,
          transform: [{ rotate: '90deg' }],
        }}
      />
    </View>
  );
}

export function PauseIcon({ color, size = 16 }: { color: string; size?: number }) {
  const bar = { width: size * 0.26, height: size * 0.8, borderRadius: size * 0.08, backgroundColor: color };
  return (
    <View style={{ width: size, height: size, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: size * 0.2 }}>
      <View style={bar} />
      <View style={bar} />
    </View>
  );
}

/** Four corner brackets: "full screen". */
export function ExpandIcon({ color, size = 14 }: { color: string; size?: number }) {
  const t = Math.max(1.75, size / 8);
  const arm = size * 0.38;
  const corner = (top: boolean, left: boolean) => ({
    position: 'absolute' as const,
    width: arm,
    height: arm,
    [top ? 'top' : 'bottom']: 0,
    [left ? 'left' : 'right']: 0,
    borderColor: color,
    [top ? 'borderTopWidth' : 'borderBottomWidth']: t,
    [left ? 'borderLeftWidth' : 'borderRightWidth']: t,
  });
  return (
    <View style={{ width: size, height: size }}>
      <View style={corner(true, true)} />
      <View style={corner(true, false)} />
      <View style={corner(false, true)} />
      <View style={corner(false, false)} />
    </View>
  );
}
