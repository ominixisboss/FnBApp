// Strategy notes for each deck archetype, used by the hero guides. Hero-specific details (ability, key cards)
// come from the card data and the bots' tuned decks.
export interface ArchetypeGuide {
  plan: string;
  tips: string[];
  against: string[];
}

export const ARCHETYPE_GUIDES: Record<string, ArchetypeGuide> = {
  'weapon-warrior': {
    plan: 'Swing your weapon every turn and make each swing count. Attack reactions add power after your opponent has chosen their blocks, and cards that give weapon attacks go again let you swing more than once a turn.',
    tips: [
      'Your weapon costs no cards to attack with: spend your hand on reactions that punish light blocks.',
      'Blue cards pay for reactions; keep one when you plan to swing.',
      'An attack reaction in your arsenal is a free threat every turn.',
      'Block small hits with equipment so your hand stays full for your own turn.',
    ],
    against: [
      'Weapon swings are steady but small. The danger is the reaction after you block, so block when they still have cards in hand.',
      'Trading blocks drains the cards they need for reactions.',
      'Save defense reactions for the turn they go all in.',
    ],
  },
  'guardian-crush': {
    plan: 'Few attacks, but huge ones. Expensive attacks hit for 6 to 9, and crush effects punish a hit of 4 or more. Between swings you block with high-defense cards and outlast the opponent.',
    tips: [
      'Pitch blue cards to pay for one big attack a turn rather than two small ones.',
      'Dominate stops the opponent from blocking with more than one card from hand: line it up for your biggest hit.',
      'You have the best blocks in the game. Defend generously and win the long game.',
    ],
    against: [
      'Keep crush hits under 4 damage: block enough to stop the effect, not necessarily the whole hit.',
      'Lots of small attacks with go again force them to block with the big cards they wanted to attack with.',
      'They usually attack once a turn, so you can plan your blocks.',
    ],
  },
  'ninja-combo': {
    plan: 'Chain many cheap attacks with go again. Combo cards get bigger when they follow the right card, so the order you play them in is everything.',
    tips: [
      'Plan the whole turn before the first card: starters first, finishers last.',
      'Zero-cost attacks keep the chain going when you are short on resources.',
      'A combo finisher in arsenal is only good if you will have its starter.',
    ],
    against: [
      'Each ninja attack is small. Let the 1–2 power links through and save blocks for the combo finishers.',
      'Ninjas spend cards quickly: survive the big turn and they have little left.',
      'Race them when you can; their blocks are weak.',
    ],
  },
  'brute-big': {
    plan: 'Hit as hard as possible. Brute attacks have 6 or more power, often with a random discard cost. Discarding another 6-power card turns on bonuses, and intimidate takes a card out of the defender’s hand for the turn.',
    tips: [
      'Run plenty of 6-power cards so random discards turn on your bonuses.',
      'Intimidate before the big swing so they have fewer cards to block it.',
      'You trade cards for damage: make every hit land.',
    ],
    against: [
      'Intimidate removes a random card from your hand until end of turn. Cards in your arsenal are safe, so a defense reaction there is a good hedge.',
      'Brutes burn through their hand. Block the big swing well and counterattack while they rebuild.',
      'Don’t over-block: one solid block card often takes most of the hit.',
    ],
  },
  'draconic-aggro': {
    plan: 'Build a long combat chain of Draconic attacks with go again. Many cards grow with the number of Draconic chain links, and rupture effects turn on at chain link 4.',
    tips: [
      'Red cards and go again keep the chain alive; count your links.',
      'Save rupture cards for the end of the chain.',
      'Recursion like Phoenix Flame gives you value from the graveyard.',
    ],
    against: [
      'The early links are small. Keep your life high, then block the big links late in the chain.',
      'After an all-in turn they are short on cards: punish it.',
    ],
  },
  'stealth-assassin': {
    plan: 'Mark the opponent and hit them with stealth attacks and daggers. Many cards get stronger against a marked hero, and the mark comes off when they are hit.',
    tips: [
      'Line up the mark first, then the payoff.',
      'Daggers are cheap pressure that turn on “if you’ve hit with a dagger” effects.',
    ],
    against: [
      'Being marked is what powers them: block the attack that would remove the mark only if it is big.',
      'Their individual attacks are small; save blocks for the payoffs against your marked hero.',
    ],
  },
  'arcane-wizard': {
    plan: 'Deal arcane damage with spells. Arcane damage can’t be blocked with cards: only arcane barrier, spellvoid and ward prevent it. Instants let you act on the opponent’s turn too.',
    tips: [
      'Amp effects make the next spell bigger: play them first.',
      'Hold instants for the opponent’s turn when they have spent their resources.',
      'Your blocks are weak, so race.',
    ],
    against: [
      'Equipment with arcane barrier or spellvoid is your best friend.',
      'Keep a resource or two (a blue card) to pay for arcane barrier.',
      'Wizards have little defense: pressure them every turn.',
    ],
  },
  'runechant': {
    plan: 'Create Runechant tokens with cheap go-again actions, then attack: each Runechant deals 1 arcane damage when you attack. A big turn turns a few small cards into a burst.',
    tips: [
      'Build Runechants, then cash them in with one attack.',
      'Runechants stay between turns, so you can build up while defending.',
    ],
    against: [
      'Runechant damage can’t be blocked. Arcane barrier, spellvoid and ward still work.',
      'Pressure them so they must spend cards on blocks instead of building Runechants.',
    ],
  },
  'mech-boost': {
    plan: 'Boost attacks: banish the top card of your deck as you attack, and if it was a Mechanologist card the attack gets go again. Items like Hyper Driver add steam and resources.',
    tips: [
      'A deck full of Mechanologist cards makes boost reliable.',
      'Boost spends your deck quickly: win before you run out.',
    ],
    against: [
      'Their deck runs out faster than yours: a long game favours you.',
      'Block steadily and don’t race them early.',
    ],
  },
  midrange: {
    plan: 'A balanced deck: solid attacks with go again, good blocks and a few reactions. Win by trading efficiently, taking a little less damage than you deal each turn.',
    tips: [
      'Count both players’ damage each turn: are you racing or defending?',
      'Use your hero ability every turn you can.',
      'A strong card in arsenal gives you a threat or a block next turn.',
    ],
    against: [
      'Learn their hero ability from the card and plan around it.',
      'Defend the biggest attacks and race the small ones.',
    ],
  },
};

/** Basics that apply to every hero. */
export const GENERAL_TIPS = [
  'Every card can attack, defend or pitch for resources. Red cards hit hardest, blue cards pay the most.',
  'Each turn: attack with what you can afford, keep blockers for their turn, and put one card in your arsenal.',
  'Go again gives back your action point, so you can play another action.',
];
