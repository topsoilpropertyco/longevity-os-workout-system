import type { Equipment } from './engine-bridge';

/** Human labels for the canonical equipment slugs. */
export function equipmentLabel(slug: Equipment): string {
  const special: Partial<Record<Equipment, string>> = {
    ez_curl_bar: 'EZ curl bar',
    ghd: 'GHD',
    bosu: 'BOSU',
    hip_abductor_adductor: 'Hip abductor / adductor',
    assisted_pullup_machine: 'Assisted pull-up machine',
    track_or_open_space: 'Track or open space',
    ski_erg: 'Ski erg',
    bench_flat: 'Flat bench',
    bench_adjustable: 'Adjustable bench',
    smith_machine: 'Smith machine',
    lat_pulldown: 'Lat pulldown',
    seated_row: 'Seated row',
    pec_deck: 'Pec deck',
    ab_crunch_machine: 'Ab crunch machine',
    back_extension_bench: 'Back extension bench',
  };
  return special[slug] ?? slug.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export const EQUIPMENT_CATEGORIES: { name: string; items: Equipment[] }[] = [
  { name: 'Free weights', items: ['bodyweight', 'dumbbell', 'adjustable_dumbbell', 'kettlebell', 'barbell', 'ez_curl_bar', 'fixed_barbell', 'trap_bar', 'bumper_plates', 'chalk'] },
  { name: 'Racks & benches', items: ['power_rack', 'smith_machine', 'bench_flat', 'bench_adjustable', 'nordic_support', 'back_extension_bench', 'ghd'] },
  { name: 'Bars & rigs', items: ['pull_up_bar', 'dip_station', 'rings', 'assisted_pullup_machine'] },
  { name: 'Cables & machines', items: ['cable_machine', 'functional_trainer', 'selectorized_machine', 'lat_pulldown', 'seated_row', 'chest_press_machine', 'shoulder_press_machine', 'pec_deck', 'leg_press', 'leg_extension', 'leg_curl', 'hip_abductor_adductor', 'calf_machine', 'ab_crunch_machine'] },
  { name: 'Cardio', items: ['treadmill', 'elliptical', 'arc_trainer', 'stair_climber', 'stationary_bike', 'recumbent_bike', 'rower', 'ski_erg', 'assault_bike', 'jump_rope'] },
  { name: 'Conditioning & plyo', items: ['sled', 'plyo_box', 'medicine_ball', 'slam_ball', 'track_or_open_space', 'outdoor_route'] },
  { name: 'Mobility & accessories', items: ['resistance_bands', 'suspension_trainer', 'stability_ball', 'bosu', 'foam_roller', 'yoga_mat', 'slant_board', 'tibialis_bar', 'wall_space'] },
];
