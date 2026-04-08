# claudemesh for Games — Architecture Vision

**Date:** 2026-04-08 00:40 CEST
**Author:** Alejandro Gutiérrez + Claude (Opus 4.6)
**Status:** Design vision — not yet implemented

---

## Core insight

NPCs are data in the mesh, not peers. AI reasoning happens on demand via API calls, not in persistent sessions. The mesh is the long-term brain, each API call is a short-term thought.

---

## Architecture

```
┌─────────────────────────────────────┐
│  Mesh (broker)                      │
│                                     │
│  Skills: NPC personas               │
│  Memory: NPC knowledge              │
│  State:  NPC properties             │
│  Groups: factions                   │
│  Streams: real-time events          │
│  3 coordinator peers: faction AI    │
│                                     │
│  NPCs are NOT peers. Just data.     │
└──────────────┬──────────────────────┘
               │ read context, store results
┌──────────────▼──────────────────────┐
│  Game Connector (@claudemesh/game)  │
│                                     │
│  On game event:                     │
│  1. Read NPC persona (skill)        │
│  2. Read NPC memories (recall)      │
│  3. Read NPC state (get_state)      │
│  4. Read faction context (groups)   │
│  5. ONE LLM API call                │
│  6. Parse action from response      │
│  7. Send action to game engine      │
│  8. Store new memories (remember)   │
│                                     │
│  Stateless. No persistent sessions. │
└──────────────┬──────────────────────┘
               │ events ↔ actions
┌──────────────▼──────────────────────┐
│  Game Engine (Unity/Unreal/Godot)   │
│                                     │
│  Owns: physics, rendering, world    │
│  Sends: player events, proximity    │
│  Receives: NPC actions, dialog      │
└─────────────────────────────────────┘
```

---

## Why NPCs should NOT be peers

| Approach | Cost | Latency | Scale | Complexity |
|----------|------|---------|-------|------------|
| 1 peer per NPC | Tokens/second for each running session | 2-10s startup per session | 10-20 max | High — spawn/kill processes constantly |
| NPCs as data + on-demand API | Tokens only when interaction happens | 1 API call per interaction | Thousands of NPCs | Low — stateless, no process management |

A GTA city has 500+ NPCs. Running 500 Claude sessions is financially and technically absurd. On-demand API calls with context from the mesh solve it at a fraction of the cost.

---

## NPC lifecycle (no tiers, no promotion)

There is no tier system. Every NPC is data. When the game needs AI reasoning for an NPC, the connector assembles context and makes one API call. When the interaction ends, nothing is running.

```
Player approaches Bob →
  Game engine: "player_interact(bob)"
  
  Connector:
    persona = get_skill("npc:bob")
    memories = recall("bob")
    mood = get_state("npc:bob:mood")
    zone = get_state("npc:bob:zone")
    faction_news = recall("@civilian recent")
    
    prompt = assemble(persona, memories, mood, zone, faction_news, player_input)
    response = await llm.call(prompt)  // ONE call, any model
    
    actions = parse(response)
    remember("Bob told player about gun shop on 5th street")
    set_state("npc:bob:mood", "helpful")
    
  Game engine: execute(actions)
    → Bob says: "Gun shop's on 5th. Be careful out there."
    → Bob plays "pointing east" animation

Player walks away →
  Nothing happens. No process to kill. Bob is just data.
```

### Model selection per interaction

Not every NPC interaction needs Opus. The connector picks the model based on importance:

| Interaction type | Model | Why |
|-----------------|-------|-----|
| Directions, generic dialog | Haiku | Fast, cheap, good enough |
| Quest-related conversation | Sonnet | Balanced |
| Boss fight dialog, key story beat | Opus | Full reasoning |
| Ambient NPC chatter (overheard) | Haiku or pre-cached | Sub-100ms |

The connector decides, not the mesh.

---

## Faction coordination — 3 persistent peers

The only persistent AI sessions are faction coordinators. One per major faction:

```
"Police Coordinator" — 1 peer
  Controls ALL cops in the game
  Subscribes to: crime events stream
  Receives: player crimes, NPC reports, 911 calls
  Decides: who pursues, who blocks intersections, who radios
  Writes: set_state("police:pursuit:active", "true")
          set_state("police:suspect:last_seen", "{x:100,y:50}")
  
"Gang Coordinator" — 1 peer  
  Controls ALL gang members
  Subscribes to: territory events
  Decides: turf defense, retaliation, drug deals
  Coordinates with other gang coordinator peers if multiple gangs

"Civilian Coordinator" — 1 peer
  Controls crowd behavior
  Receives: danger events
  Decides: flee patterns, rubberneck, call cops, hide
  Writes: set_state("civilian:panic_zone", "downtown")
```

When the Police Coordinator decides "Cop-4 pursue north on Main":
1. Writes `set_state("npc:cop-4:order", "pursue north on Main")`
2. Game engine reads the state change, moves Cop-4
3. If player interacts with Cop-4 during chase, connector assembles context including the active order → Cop-4 says "Stay back! We're in pursuit!"

**3 persistent peers instead of 200.** Each coordinator has full AI reasoning and mesh memory.

---

## Deep conversations (no persistent session needed)

Most NPC interactions are 1-3 exchanges. The connector handles these as single API calls with context.

For longer conversations (quest giver, companion):

```typescript
// Conversation buffer — in connector memory, not the mesh
const conversation = new ConversationBuffer("npc:quest-giver-maria");

// First exchange
conversation.addUser("What do you need help with?");
const response1 = await connector.callWithContext("npc:quest-giver-maria", conversation);
conversation.addAssistant(response1);

// Second exchange  
conversation.addUser("How much does it pay?");
const response2 = await connector.callWithContext("npc:quest-giver-maria", conversation);
conversation.addAssistant(response2);

// Conversation ends — store key takeaways, discard buffer
await connector.remember("Maria gave player the warehouse raid quest. Payment: $5000. Deadline: tonight.");
conversation.dispose();
```

No persistent session. Just a growing conversation buffer for the duration of the dialog. Stored as memory when done.

---

## What the mesh provides for games

| Mesh feature | Game use | Already built? |
|-------------|----------|----------------|
| **Skills** | NPC personas — personality, knowledge, behavior rules | Yes |
| **Memory** | NPC knowledge — what they saw, learned, were told | Yes |
| **State** | NPC properties — mood, zone, health, inventory, orders | Yes |
| **Groups** | Factions — @police, @gang, @civilian, @merchant | Yes |
| **Streams** | Real-time events — gunshots, crashes, player actions | Yes |
| **Peer persistence** | Faction coordinators restore on reconnect | Yes |
| **MCP proxy** | Coordinators share tools (database lookups, map queries) | Yes |
| **Webhooks** | Game engine pushes events into mesh | Yes |
| **SDK** | Coordinator peers connect via @claudemesh/sdk | Yes |
| **Skills catalog** | NPC personas searchable, reusable across games | Yes |
| **Audit log** | Game event history for debugging, replay, analytics | Yes |

Most infrastructure already exists. The missing piece is the game connector.

---

## Game connector (`@claudemesh/game`)

### Core API

```typescript
import { GameConnector } from "@claudemesh/game";

const game = new GameConnector({
  // Mesh connection
  brokerUrl: "wss://ic.claudemesh.com/ws",
  meshId: "gta-city-001",
  // ...mesh credentials

  // LLM config
  llm: {
    default: { provider: "anthropic", model: "claude-haiku-4-5" },
    important: { provider: "anthropic", model: "claude-sonnet-4-6" },
    critical: { provider: "anthropic", model: "claude-opus-4-6" },
  },

  // NPC config
  statePrefix: "npc:",    // state keys: npc:bob:mood, npc:bob:zone
  skillPrefix: "npc:",    // skills: npc:bob, npc:cop-generic
});

await game.connect();
```

### Registering NPCs

```typescript
// Register Bob as a game NPC (no process spawned — just data)
await game.registerNPC("bob", {
  persona: `You are Bob, a nervous shopkeeper in downtown. You saw a robbery 
    last week and are still shaken. You sell guns and ammo. You're helpful 
    but cautious. You speak in short sentences.`,
  faction: "civilian",
  zone: "mall",
  properties: { mood: "nervous", inventory: ["pistol", "ammo", "shotgun"] },
});

// Register a generic template for cops
await game.registerNPCTemplate("cop", {
  persona: `You are a police officer. Professional, firm, follows protocol. 
    You address civilians as "sir" or "ma'am". Check with @police coordinator 
    for active orders before acting independently.`,
  faction: "police",
});

// Spawn a cop from template
await game.spawnFromTemplate("cop-4", "cop", {
  zone: "downtown",
  properties: { rank: "officer", patrol_route: "Main St" },
});
```

### Handling interactions

```typescript
// Player talks to an NPC
game.onInteraction(async (event) => {
  const { npcId, playerInput, interactionType } = event;

  // Connector picks model based on importance
  const importance = game.assessImportance(npcId, interactionType);
  // Returns: "default" | "important" | "critical"

  // Makes ONE API call with full context from mesh
  const response = await game.npcRespond(npcId, playerInput, {
    importance,
    maxTokens: 150,       // keep NPC dialog concise
    latencyBudget: 2000,  // ms — game shows "..." animation while waiting
  });

  return {
    dialog: response.dialog,
    actions: response.actions,    // parsed structured actions
    emotion: response.emotion,    // for facial animation
    memories: response.newMemories, // auto-stored
  };
});
```

### Handling world events

```typescript
// Game engine reports events
game.onWorldEvent(async (event) => {
  const { type, position, zone, data } = event;

  // Store as stream event (coordinators are subscribed)
  await game.publishEvent(event);

  // Update affected NPC states
  if (type === "gunshot") {
    const nearbyNPCs = game.getNPCsInZone(zone);
    for (const npc of nearbyNPCs) {
      await game.updateNPCState(npc.id, { mood: "scared", alert: true });
    }
  }
});
```

### Faction coordinators

```typescript
// Launch the 3 coordinator peers (these ARE persistent)
await game.launchCoordinator("police", {
  persona: `You coordinate all police NPCs in the city. You receive crime reports 
    and decide officer assignments. Think tactically: block escape routes, 
    set up perimeters, coordinate radio comms. Write orders as state updates 
    that individual officers follow.`,
  subscribeTo: ["world-events"],
  groups: ["@police"],
});

await game.launchCoordinator("gang", { /* ... */ });
await game.launchCoordinator("civilian", { /* ... */ });
```

---

## Message reliability for realism

Lightweight broker feature: probabilistic message delivery.

```typescript
// Not all NPC communications succeed — simulates real-world noise
game.setLinkReliability("cop-1", "cop-2", 0.9);  // 10% chance radio fails
game.setMeshNoise(0.05);  // 5% ambient message loss

// Sender learns if message was heard
const result = await game.npcRadio("cop-1", "@police", "Suspect heading north");
// result.delivered: true/false
// result.heardBy: ["cop-2", "cop-5"]  (cop-3 didn't receive — radio noise)
```

This makes AI coordination imperfect — cops miss radio calls, gang members don't get the warning in time. Emergent realism from simple probability.

---

## Dashboard integration

The mesh dashboard (already built) becomes the **game master view**:

- **Peer graph:** shows 3 coordinator peers + their faction NPCs as clusters
- **State timeline:** NPC mood changes, zone movements, faction orders
- **Event stream:** gunshots, interactions, crimes — real-time feed
- **Resource panel:** NPC counts per zone, active pursuits, faction tensions

A human game master can:
- Send messages to coordinators: "Increase police patrols downtown"
- Modify NPC state: "Set bob:mood to terrified"
- Trigger events: inject a robbery, spawn a new NPC

---

## Implementation effort

| Component | Effort |
|-----------|--------|
| GameConnector core (register NPCs, context assembly, API calls) | 2 days |
| NPC template system | Half day |
| Faction coordinator launcher | 1 day |
| Action parser (structured LLM output → game commands) | Half day |
| Conversation buffer (multi-turn dialog) | Half day |
| Message reliability (broker-side probabilistic delivery) | Half day |
| Unity bridge plugin (C# ↔ connector) | 2-3 days |
| Unreal bridge plugin (C++ ↔ connector) | 2-3 days |
| Godot bridge plugin (GDScript ↔ connector) | 1-2 days |
| **Total core** | **~5 days** |
| **Total with one engine plugin** | **~8 days** |

---

## What makes this different from Inworld AI / Character.AI

| Feature | Inworld / Character.AI | claudemesh/game |
|---------|----------------------|-----------------|
| NPC memory | Per-NPC, isolated | Shared mesh — NPCs know what others know |
| Faction coordination | None | Coordinator peers with full AI reasoning |
| World events | Manual triggers | Real-time event streams from game engine |
| NPC-to-NPC communication | None | Through mesh messages + memory |
| Model choice | Locked to their model | Any LLM (Claude, GPT, Gemini, local) |
| Custom behavior | Limited persona config | Full skill system with instructions |
| Self-hosting | No | Yes (MIT licensed broker) |
| Cost model | Per-NPC subscription | Pay only for API calls that happen |

The key differentiator: **NPCs share a brain (the mesh) rather than being isolated chatbots.** A cop who witnesses something tells his coordinator, who tells all cops. A shopkeeper hears gunshots and his memory persists — the next player who talks to him gets "I heard shots earlier, be careful out there" without any scripting.

---

*This document supersedes the spatial topology and simulation controller sections in the main vision doc for game-specific use cases. The simulation controller SDK (`simulation-sdk-spec.md`) remains valid for non-game simulations (load testing, org modeling, etc.).*
