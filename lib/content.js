// ===================== GAME CONTENT — edit here =====================
// Round 1: car logos. Put the logo image for each number in public/logos/<n>.png
// (use logo versions WITHOUT the brand name written on them).
const LOGOS = [
  { n: 1, answer: 'Lamborghini', aliases: ['Lambo'] },
  { n: 2, answer: 'Porsche', aliases: [] },
  { n: 3, answer: 'Mazda', aliases: [] },
  { n: 4, answer: 'Aston Martin', aliases: ['Aston'] },
  { n: 5, answer: 'Lexus', aliases: [] },
  { n: 6, answer: 'Koenigsegg', aliases: ['Koenigseg', 'Koenigsgg'] },
  { n: 7, answer: 'Jaguar', aliases: ['Jag'] },
  { n: 8, answer: 'Mitsubishi', aliases: [] },
  { n: 9, answer: 'Bentley', aliases: [] },
  { n: 10, answer: 'Volkswagen', aliases: ['VW'] },
];

// Round 2: car parts. Each game hides 12 of these (a 9×9 grid can't hold all 20).
const PARTS = ['Clutch', 'Airbag', 'Exhaust', 'Wiper', 'Spoiler', 'Headlamp', 'Bumper', 'Horn', 'Gear', 'Belt',
  'Wheel', 'Brake', 'Engine', 'Battery', 'Headrest', 'Sunroof', 'Odometer', 'Seatbelt', 'Window', 'Hood'];
const PARTS_PER_GAME = 12;

// Round 3: the movie title whose letters get shuffled.
const MOVIE = 'Fast and Furious';

// Default player list for the join dropdown (editable at /admin without redeploying).
const ROSTER = ['Kavya', 'Naeem', 'Bijith', 'Shaphy', 'Nibras', 'Thomas', 'Meenu'];

module.exports = { LOGOS, PARTS, PARTS_PER_GAME, MOVIE, ROSTER };
