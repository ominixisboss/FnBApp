import type { ReactNode } from 'react';
import { SymText } from '../ui/symbols';

export interface Lesson {
  id: string;
  title: string;
  body: ReactNode;
}

const C = ({ children }: { children: ReactNode }) => <div className="callout">{children}</div>;

export const LESSONS: Lesson[] = [
  {
    id: 'basics',
    title: '1. The goal & your hero',
    body: (
      <>
        <p>
          <b>Flesh and Blood</b> (FaB) is a one-on-one trading card game. Each player picks a <b>hero</b>: a card that sets your
          starting <b>life</b>, your <b>intellect</b> (how many cards you draw up to each turn), and your <b>class</b> (Warrior,
          Ninja, Wizard, …), which decides which cards you can put in your deck.
        </p>
        <p>You win by bringing the opposing hero’s life to <b>0</b>.</p>
        <C>
          <b>Formats in this app</b>
          <ul>
            <li><b>Blitz</b>: a <i>young</i> hero (about 20 life), a 40-card deck, max 2 copies of each card. Fast games, ideal for learning.</li>
            <li><b>Classic Constructed (CC)</b>: an <i>adult</i> hero (about 40 life), 60+ cards, max 3 copies. The main competitive format.</li>
          </ul>
        </C>
        <p>
          Besides the deck, you start with <b>weapons</b> and <b>equipment</b> (head, chest, arms, legs) already in play. Weapons give you
          an attack every turn. Equipment mostly helps you <i>defend</i>.
        </p>
      </>
    ),
  },
  {
    id: 'cards',
    title: '2. Reading a card: pitch, cost, power, defense',
    body: (
      <>
        <p>Most cards have four numbers:</p>
        <ul>
          <li><b>Pitch</b> (top-left gems, shown by the colour strip): how many resources the card gives if you <i>pitch</i> it to pay for something. Red = 1, yellow = 2, blue = 3.</li>
          <li><b>Cost</b> (top-right): resources you must pay to play it.</li>
          <li><b>Power</b> (bottom-left, ⚔): damage it deals if it’s an attack.</li>
          <li><b>Defense</b> (bottom-right, ⛨): how much damage it blocks when you defend with it.</li>
        </ul>
        <C>
          <b>The colour trade-off.</b> Many cards come in three versions. The <span style={{ color: 'var(--red)' }}>red</span> one is the strongest
          but pitches for only 1. The <span style={{ color: 'var(--blue)' }}>blue</span> one is weakest but pitches for 3. A good deck mixes
          cards you want to <i>play</i> with cards that <i>pay</i> for them.
        </C>
        <p>
          The big idea in FaB: <b>every card can be used several ways.</b> You can play it, pitch it for resources, defend with it, or hold
          it in your arsenal. Most of your decisions are about which job to give each card.
        </p>
      </>
    ),
  },
  {
    id: 'turn',
    title: '3. Turn structure & action points',
    body: (
      <>
        <ol>
          <li><b>Start phase.</b> Start-of-turn effects happen (for example, some tokens).</li>
          <li><b>Action phase.</b> You get <b>1 action point</b>. Playing an <i>action</i> card (attack or non-attack) or activating a weapon costs 1 action point. <b>Instants</b> cost no action point.</li>
          <li><b>End phase.</b> You may put one card from your hand face-down into your <b>arsenal</b> (if it’s empty). Cards you pitched go to the bottom of your deck. Then you <b>draw up to your intellect</b>.</li>
        </ol>
        <C>
          <b>Go again</b> is the key keyword: when a card with go again resolves, you get your action point back. That lets you chain
          several attacks in one turn. A typical turn looks like <i>go-again attack → go-again attack → big finisher</i>.
        </C>
        <p>
          Your hand refills only at the end of <b>your</b> turn. Cards you keep through the opponent’s turn can defend, then be used on your next turn.
        </p>
      </>
    ),
  },
  {
    id: 'resources',
    title: '4. Paying costs by pitching',
    body: (
      <>
        <p>
          To pay a cost, you <b>pitch</b> cards from your hand. Each one adds its pitch value to your resource pool. Unused resources
          stay available until the end of the turn. Pitched cards go to the <b>bottom of your deck</b> at the end of the turn, so they come
          back later.
        </p>
        <C>
          <b>Example:</b> you hold a red 3-cost attack with 7 power and a blue card. Pitch the blue (+3), pay 3, and attack for 7. That’s 7
          damage from two cards. The usual target is <b>“about 3+ damage per card”</b> on offense.
        </C>
        <p>
          In this app, click a card to play it. If you can’t already pay for it, the app asks you to click cards to pitch, or you can press <b>Auto-pay</b>.
        </p>
      </>
    ),
  },
  {
    id: 'combat',
    title: '5. Combat: the combat chain',
    body: (
      <>
        <p>Each attack creates a <b>chain link</b> and goes through these steps:</p>
        <ol>
          <li><b>Attack</b>: the attack card (or weapon) is put on the combat chain. “When this attacks” effects happen.</li>
          <li><b>Defend</b>: the defender may block with any number of cards from hand (with a ⛨ value) and equipment.</li>
          <li><b>Reaction</b>: the attacker may play <b>attack reactions</b> (pump the attack), the defender <b>defense reactions</b> (extra blocks). Instants work here too. Players take turns until both pass.</li>
          <li><b>Damage</b>: the defender takes <i>power − total defense</i>. If that’s more than 0, the attack <b>hits</b> and “on hit” effects happen.</li>
          <li><b>Resolution</b>: if the attack had go again, the attacker gets an action point back.</li>
        </ol>
        <p>When the attacker is out of action points (or chooses to stop), the chain closes and attack cards go to the graveyard.</p>
        <C>
          <b>Combat keywords:</b> <b>Dominate</b>: can’t be blocked by more than 1 card from hand. <b>Overpower</b>: can’t be blocked by
          more than 1 action card. <b>Intimidate</b>: a random card from the defender’s hand is banished until end of turn.
        </C>
      </>
    ),
  },
  {
    id: 'defense',
    title: '6. Defending: life is a resource',
    body: (
      <>
        <p>
          Blocking costs you cards you could have used on your turn. A red card that blocks 3 might have dealt 6 damage next turn. So
          the question is always: <b>what is each card worth if I keep it?</b>
        </p>
        <ul>
          <li>Block with cards that are <b>bad on offense but good on defense</b> (often blues with 3 defense).</li>
          <li><b>Equipment</b> blocks for free, but wears out. <b>Battleworn</b> loses 1 defense after each block. <b>Blade Break</b> is destroyed after one block. <b>Temper</b> loses 1 defense each time and breaks at 0.</li>
          <li>Take small hits early, and block harder when your life gets low or when the attack has a nasty on-hit effect.</li>
          <li><b>Don’t over-block:</b> blocking 6 against a 4-power attack wastes cards.</li>
        </ul>
        <C>The hint system in practice games uses this same logic. Watch when it says to take the hit and when it says to block.</C>
      </>
    ),
  },
  {
    id: 'arsenal',
    title: '7. Arsenal, reactions & instants',
    body: (
      <>
        <p>
          The <b>arsenal</b> holds one face-down card that you can play later, on your turn or as a reaction on theirs. It’s great for a
          strong attack you couldn’t afford this turn, or a defense reaction to surprise the opponent. Some cards get bonuses “if played from arsenal”.
        </p>
        <p>
          <b>Attack reactions</b> can only be played during the reaction step of your own attack. <b>Defense reactions</b> only when you’re
          defending; they count as extra blockers. <b>Instants</b> can be played whenever you have priority.
        </p>
      </>
    ),
  },
  {
    id: 'strategy',
    title: '8. Strategy fundamentals',
    body: (
      <>
        <ul>
          <li><b>Plan the whole turn before you play the first card.</b> Count your resources, action points and go-again chain.</li>
          <li><b>Value per card:</b> aim for about 3 or more damage (or prevention) per card you spend. Over many turns, the player who gets more value from their cards wins.</li>
          <li><b>Tempo:</b> sometimes it’s right to pass with a full hand so you can block well and swing harder next turn.</li>
          <li><b>Pitch order matters:</b> pitched cards go to the bottom of your deck, so blues pitched now come back later.</li>
          <li><b>Know the matchup:</b> aggressive heroes punish slow hands, and defensive heroes punish weak attacks.</li>
        </ul>
        <C>Try a guided practice game. Follow the hints, then turn them off and play against harder bots.</C>
      </>
    ),
  },
  {
    id: 'advanced',
    title: '9. Advanced mechanics',
    body: (
      <>
        <p>Card text uses small symbols. In this app they appear as icons:</p>
        <ul>
          <li><SymText text="{r}" /> resource, <SymText text="{p}" /> power, <SymText text="{d}" /> defense, <SymText text="{h}" /> life, <SymText text="{i}" /> intellect</li>
          <li><SymText text="{t}" /> tap and <SymText text="{u}" /> untap</li>
        </ul>
        <h3>Tapping</h3>
        <p>
          Some costs say <SymText text="{t}" />: turn the card sideways. A tapped hero, ally, item or cog can’t pay another <SymText text="{t}" /> cost until it
          untaps at the start of its controller’s turn. Tapped cards tilt and show a ⟲ badge. Equipment and weapons that tap count as used for the turn.
        </p>
        <h3>Allies</h3>
        <p>
          Allies are permanents with power and life. One that says “Action - <SymText text="{t}" />: Attack” attacks with its own power, and it stays in the arena afterwards.
          An ally attack isn’t a weapon attack, so “weapon attacks get +1<SymText text="{p}" />” doesn’t apply. Attacks can target allies, and an ally is destroyed when damage reaches its life.
          Tap an ally to use it. If it has two abilities, you’ll get a menu.
        </p>
        <h3>Triggered abilities</h3>
        <p>
          Auras, items, allies, equipment and weapons often say “When…”, “Whenever…” or “At the beginning of…”. These happen by themselves:
          at the start of your turn, at the start of your action phase or end phase, when the combat chain closes, when you play an attack, when one hits, when you boost, beat chest or win a wager.
          “You may” abilities ask you first. The log shows each one as it happens.
        </p>
        <h3>The attacking card’s own abilities</h3>
        <p>
          Some attacks have instant abilities, like “Instant - <SymText text="{t}" /> a cog you control: This gets +1<SymText text="{p}" />”. They can be used while the card is the
          active attack. Tap it on the combat chain.
        </p>
        <h3>Meld</h3>
        <p>
          A meld card (“Arcane Seeds // Life”) has two halves. Play the left half, the right half, or both. The Action half needs an action point like any action. The Instant half can be played any time you could play an instant.
        </p>
        <h3>Transcend</h3>
        <p>
          Mystic cards say “If you’ve played another blue card this turn, transcend”. Once you transcend, every “If you’ve transcended this turn” payoff is on for the rest of the turn.
        </p>
        <h3>Dice, “counts as” and Pit Fight</h3>
        <ul>
          <li>“Roll a 6 sided die”: the roll appears in the log, and the card uses the number rolled.</li>
          <li>“This counts as a Gold / Runechant”: it is counted and spent as one. A card that counts as a Runechant goes off like one when you attack, plus its own “usurp” bonus.</li>
          <li>In Pit Fight, “each opponent”, “each other hero” and “each hero” really means everyone else at the table.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'app',
    title: '10. How this simulator works',
    body: (
      <>
        <p>
          The app includes the <b>full card database</b>. The rules engine automates the core game: pitching, action points, go again, the
          combat chain, blocking with hand and equipment, reactions, arsenal, end-of-turn draw, and common keywords (dominate, overpower,
          intimidate, piercing, ward, arcane barrier, spellvoid, battleworn, blade break, temper, boost). It also handles common tokens (Runechant, Quicken, Might, Agility, Vigor, Ponder, …).
        </p>
        <p>
          Card text is compiled automatically from templated sentences such as “Draw a card”, “Deal 2 arcane damage”, “Your next attack
          this turn gets +2{'{p}'}”, “When this hits, …” and “If this was played from arsenal, …”. Each card’s detail page shows how much of its text is automated.
        </p>
        <p>
          Hero abilities are automated, and so are triggered abilities, tapping, ally attacks, meld, transcend and dice.
          About two in five cards have their full text automated, and another quarter have part of it. The cards people play most come first.
        </p>
        <C>
          <b>Not everything is automated yet</b>: many unique card effects aren’t. Open the <b>🛠 Manual</b> panel in a
          game to adjust life, draw, add resources or action points, change attack power, or create tokens. That lets you apply any text yourself.
        </C>
      </>
    ),
  },
];

export const GLOSSARY: [string, string][] = [
  ['Go again', 'When this resolves you gain an action point, so you can keep acting.'],
  ['Dominate', 'This attack can’t be defended by more than one card from hand.'],
  ['Overpower', 'This attack can’t be defended by more than one action card.'],
  ['Intimidate', 'Banish a random card from the defending hero’s hand face-down; it returns at end of turn.'],
  ['Piercing N', 'If defended by equipment, this gets +N power.'],
  ['Ward N', 'If you would be dealt damage, prevent N of it and destroy this.'],
  ['Arcane Barrier N', 'You may pay up to N resources to prevent that much arcane damage.'],
  ['Spellvoid N', 'Destroy this to prevent N arcane damage.'],
  ['Battleworn', 'When this defends, it gets a −1 defense counter afterward.'],
  ['Blade Break', 'When this defends, destroy it after the chain link.'],
  ['Temper', 'When this defends, it gets a −1 defense counter; destroy it when its defense is 0.'],
  ['Boost', '(Mechanologist) You may banish the top card of your deck; if it’s a Mechanologist card, this attack gets go again.'],
  ['Opt N', 'Look at the top N cards of your deck and put them on the top and/or bottom in any order.'],
  ['Combo', 'Gets a bonus if the previous chain link was a specific card (Ninja).'],
  ['Phantasm', 'If this is defended by a non-Illusionist attack action card with 6+ power, destroy it.'],
  ['Blood Debt', 'At the start of your end phase, if this is in your banished zone, lose 1 life.'],
  ['Arcane damage', 'Non-combat damage typically from Wizards and Runeblades; can be prevented by arcane barrier / spellvoid.'],
  ['Arsenal', 'A zone holding one face-down card you can play later.'],
  ['Pitch', 'Put a card from your hand into the pitch zone to gain resources equal to its pitch value.'],
  ['Intellect', 'You draw up to this many cards at the end of your turn.'],
  ['Legendary', 'Only one copy allowed in a deck.'],
  ['Specialization', 'Only the named hero can include this card.'],
  ['Tap ({t}) / Untap ({u})', 'Turn a card sideways to pay a cost; it untaps at the start of its controller’s turn.'],
  ['Ally', 'A permanent with power and life that can attack with its own ability and stays in the arena.'],
  ['Meld', 'A two-halved card: play either half, or both.'],
  ['Transcend', 'A Mystic card turns over; “if you’ve transcended this turn” payoffs apply.'],
  ['Usurp', 'When an attack uses up a card that counts as a Runechant, that card’s own bonus applies.'],
  ['Crush', 'A bonus when this deals 4 or more damage to a hero.'],
  ['Wager', 'Both heroes stake something; if the attack hits, its attacker wins the wager, otherwise the defending hero does.'],
  ['Clash', 'Each hero reveals the top card of their deck; the one with the greater power wins.'],
  ['Protect', '(Pit Fight) This can defend an attack aimed at another hero.'],
];
