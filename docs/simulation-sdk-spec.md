# @claudemesh/sim — Simulation Controller SDK

**Date:** 2026-04-08
**Status:** Design spec — not yet implemented

---

## Architecture

The mesh is the communication fabric, not the simulation engine. Simulation logic lives in **controllers** — external processes that connect to the mesh as peers and drive the simulation loop.

```
┌─────────────────────────┐
│    3D Space / UI        │  Renders world state,
│  (Three.js, Unity,      │  provides human input
│   dashboard, Python)    │
└───────────┬─────────────┘
            │ reads state, sends commands
┌───────────┴─────────────┐
│   Simulation Controller │  Owns world model,
│   (@claudemesh/sim)     │  computes observations,
│                         │  collects actions
└───────────┬─────────────┘
            │ mesh messages + state
┌───────────┴─────────────┐
│        Mesh (broker)    │  Delivers messages,
│                         │  holds shared state,
│                         │  drives clock ticks
└───────────┬─────────────┘
      ┌─────┼─────┐
   ┌──┴──┐ ┌┴───┐ ┌┴───┐
   │Peer │ │Peer│ │Peer│   AI agents with
   │"Rep"│ │"C1"│ │"Mgr"│  personas, react
   └─────┘ └────┘ └────┘   to observations
```

**Separation of concerns:**
- **Mesh:** messages, state, peers, clock ticks
- **Controller:** world model, physics, visibility, rules, tick loop
- **3D/UI:** rendering, human input (optional)
- **AI peers:** persona behavior, actions, communication

---

## SimController class

```typescript
import { SimController } from "@claudemesh/sim";

const sim = new SimController({
  // Mesh connection (uses @claudemesh/sdk under the hood)
  brokerUrl: "wss://ic.claudemesh.com/ws",
  meshId: "sim-store-001",
  memberId: "controller-floor",
  pubkey: keys.publicKey,
  secretKey: keys.secretKey,
  displayName: "Floor Controller",

  // Controller config
  role: "orchestrator",       // "orchestrator" | "domain"
  domain: "floor",            // state namespace prefix: "sim:floor:*"
  tickSource: "clock",        // "clock" (follow mesh clock) | "self" (drive own ticks)
  tickInterval: 1000,         // ms, only used when tickSource: "self"
});
```

### Lifecycle

```typescript
await sim.connect();

// Define the world
sim.defineZones({
  "store-floor": { connects: ["checkout", "office"], capacity: 20 },
  "checkout":    { connects: ["store-floor", "warehouse"], capacity: 5 },
  "warehouse":   { connects: ["checkout"], capacity: 10 },
  "office":      { connects: ["store-floor"], capacity: 4 },
});

// Place peers in zones
sim.placePeer("Sales-Rep-1", "store-floor");
sim.placePeer("Customer-1", "store-floor");
sim.placePeer("Manager", "office");

// Define obstructions (optional — for geometric mode)
sim.addObstruction("wall-1", { from: {x:0, y:5}, to: {x:10, y:5} });

// Define visibility rules
sim.setVisibilityMode("zone");  // "zone" | "radius" | "custom"
// zone: peers in same zone + connected zones can see each other
// radius: distance check with optional obstructions (line-of-sight)
// custom: provide your own function

// Custom visibility (most flexible)
sim.setVisibilityFn((peerA, peerB, world) => {
  // Your logic: zones, distance, line-of-sight, roles, anything
  return peerA.zone === peerB.zone;
});

// Start the simulation
sim.start();
```

### Tick loop

The controller runs a loop — either driven by mesh clock ticks or self-driven:

```typescript
sim.onTick(async (tick) => {
  // 1. Read world state
  const world = sim.getWorldState();

  // 2. Compute visibility for each peer
  const visibility = sim.computeVisibility();
  // Returns: { "Sales-Rep-1": ["Customer-1"], "Customer-1": ["Sales-Rep-1"], "Manager": [] }

  // 3. Build observations per peer
  for (const [peerName, visiblePeers] of Object.entries(visibility)) {
    const peer = world.peers[peerName];
    const observation = {
      tick: tick.number,
      simTime: tick.simTime,
      you: { zone: peer.zone, role: peer.role },
      visible_peers: visiblePeers.map(name => ({
        name,
        zone: world.peers[name].zone,
        role: world.peers[name].role,
        status: world.peers[name].lastAction,
      })),
      environment: sim.getZoneState(peer.zone),
      events: sim.getEventsFor(peerName),
    };

    // 4. Send observation to the peer
    await sim.sendObservation(peerName, observation);
  }

  // 5. Collect actions from previous tick
  const actions = sim.collectActions();
  // Returns: [{ peer: "Sales-Rep-1", action: "greet", target: "Customer-1" }, ...]

  // 6. Apply actions to world state
  for (const action of actions) {
    sim.applyAction(action);
  }

  // 7. Publish world state (for dashboard/3D renderer)
  await sim.publishWorldState();
});
```

### Observations and actions protocol

**Observation (controller → peer):** Sent as a mesh message with a structured format. The peer's MCP server receives it as a channel notification.

```json
{
  "type": "sim_observation",
  "tick": 42,
  "simTime": "2026-04-08T14:30:00Z",
  "you": {
    "zone": "store-floor",
    "position": { "x": 10, "y": 5 },
    "role": "sales-rep",
    "inventory": ["catalog", "tablet"]
  },
  "visible_peers": [
    { "name": "Customer-1", "zone": "store-floor", "status": "browsing" }
  ],
  "environment": {
    "zone": "store-floor",
    "customers_present": 3,
    "noise_level": "moderate",
    "time_of_day": "afternoon"
  },
  "events": [
    "Customer-1 entered your zone",
    "New shipment arrived in warehouse"
  ],
  "available_actions": [
    "greet <peer>",
    "show_product <sku> <peer>",
    "check_inventory <sku>",
    "move_to <zone>",
    "radio <message>"
  ]
}
```

**Action (peer → controller):** Peer sends a structured message back to the controller.

```json
{
  "type": "sim_action",
  "tick": 42,
  "actions": [
    { "action": "greet", "target": "Customer-1" },
    { "action": "show_product", "sku": "ABC-123", "target": "Customer-1" }
  ]
}
```

The controller validates actions (can this peer do this? are they in the right zone?) and applies valid ones to the world state.

---

## Multi-controller pattern

### Federated controllers

Each controller owns a domain — its slice of the world. They coordinate through mesh state.

```typescript
// Floor controller — owns positions, zones, visibility
const floor = new SimController({
  role: "domain",
  domain: "floor",
  tickSource: "clock",
});

// Inventory controller — owns stock, pricing
const inventory = new SimController({
  role: "domain",
  domain: "inventory",
  tickSource: "clock",
});

// Orchestrator — merges domains into unified observations
const orchestrator = new SimController({
  role: "orchestrator",
  domains: ["floor", "inventory", "queue"],
  tickSource: "clock",
});

orchestrator.onTick(async (tick) => {
  // Read all domain states
  const floor = await orchestrator.getDomainState("floor");
  const inventory = await orchestrator.getDomainState("inventory");

  // Merge into unified observation per peer
  for (const peer of orchestrator.getPeers()) {
    const obs = mergeObservation(peer, floor, inventory);
    await orchestrator.sendObservation(peer.name, obs);
  }
});
```

### State namespacing

Each domain writes to its own namespace:

```
sim:floor:positions     → {"Alice": {"x":10,"y":5}, "Bob": {"x":3,"y":8}}
sim:floor:zones         → {"store-floor": {"peers": ["Alice","Bob"]}}
sim:inventory:stock     → {"ABC-123": 42, "DEF-456": 0}
sim:queue:lines         → [{"id": 1, "length": 3, "cashier": "Carol"}]
sim:orchestrator:tick   → 42
```

Any peer, controller, or dashboard reads state to render or react.

---

## World state management

```typescript
// Define entity types
sim.defineEntityType("product", {
  sku: "string",
  name: "string",
  price: "number",
  stock: "number",
  zone: "string",
});

// Create entities
sim.createEntity("product", { sku: "ABC-123", name: "Widget", price: 29.99, stock: 42, zone: "store-floor" });

// Query entities
const products = sim.queryEntities("product", { zone: "store-floor" });

// Peer actions modify entities
sim.defineAction("purchase", {
  validate: (peer, args, world) => {
    const product = world.getEntity("product", args.sku);
    return product && product.stock > 0 && peer.zone === product.zone;
  },
  apply: (peer, args, world) => {
    const product = world.getEntity("product", args.sku);
    product.stock -= 1;
    peer.inventory.push(args.sku);
    return { event: `${peer.name} purchased ${product.name}` };
  },
});
```

---

## Dashboard integration

The 3D/UI reads world state from the mesh and renders it. No special protocol — just `get_state`.

```javascript
// Three.js dashboard
const positions = JSON.parse(await mesh.getState("sim:floor:positions"));
for (const [name, pos] of Object.entries(positions)) {
  updatePeerMarker(name, pos.x, pos.y);
}

// Or subscribe to a stream
mesh.subscribe("sim:world");
mesh.on("stream_data", (data) => {
  renderFrame(data);
});
```

Human input flows back through the mesh:
```javascript
// User clicks to move a peer
canvas.on("click", (pos) => {
  mesh.send("Floor Controller", JSON.stringify({
    type: "sim_command",
    command: "move_peer",
    peer: selectedPeer,
    to: { x: pos.x, y: pos.y },
  }));
});
```

---

## Package structure

```
packages/sim/
  package.json          @claudemesh/sim
  src/
    index.ts            Main exports
    controller.ts       SimController class
    world.ts            WorldState manager
    visibility.ts       Zone-based + radius + custom visibility
    actions.ts          Action validation + application
    entities.ts         Entity type system
    observation.ts      Observation builder
    protocol.ts         Message format constants
    types.ts            TypeScript types
  README.md
```

**Dependencies:**
- `@claudemesh/sdk` — mesh connectivity
- No physics engine — keep it lightweight. Users bring their own for geometric mode.

---

## Example: retail store simulation

```typescript
import { SimController } from "@claudemesh/sim";

const sim = new SimController({ /* mesh config */ });
await sim.connect();

// World setup
sim.defineZones({
  "entrance": { connects: ["store-floor"] },
  "store-floor": { connects: ["entrance", "checkout", "fitting-room"] },
  "fitting-room": { connects: ["store-floor"] },
  "checkout": { connects: ["store-floor", "back-office"] },
  "back-office": { connects: ["checkout"] },
});

// Peer personas (mesh skills)
await sim.shareSkill("sales-rep", {
  instructions: "You are a retail sales rep. Greet customers who enter your zone. Show products when asked. Guide to fitting room or checkout. Be helpful but not pushy.",
});
await sim.shareSkill("customer", {
  instructions: "You are a customer shopping for clothes. Browse, ask questions, try things on. You have a budget of $200. Make realistic decisions.",
});

// Place peers
sim.placePeer("Rep-1", "store-floor", { role: "sales-rep", skill: "sales-rep" });
sim.placePeer("Rep-2", "store-floor", { role: "sales-rep", skill: "sales-rep" });
sim.placePeer("Cust-1", "entrance", { role: "customer", skill: "customer" });
sim.placePeer("Cust-2", "entrance", { role: "customer", skill: "customer" });
sim.placePeer("Manager", "back-office", { role: "manager" });

// Set clock to 10x
await sim.setClock(10);

// Run
sim.start();

// After N ticks, generate report
sim.onComplete(async (report) => {
  console.log(`Simulation complete: ${report.ticks} ticks`);
  console.log(`Actions: ${report.totalActions}`);
  console.log(`Sales: ${report.entities.product.filter(p => p.stock === 0).length} sold out`);
  console.log(`Customer satisfaction: ${report.metrics.satisfaction}`);
});
```

---

## Effort estimate

| Component | Effort |
|-----------|--------|
| SimController core (tick loop, observations, actions) | 2 days |
| World state + entity system | 1 day |
| Visibility (zone + radius + custom) | 1 day |
| Protocol (observation/action message format) | Half day |
| Dashboard integration examples | Half day |
| Retail store example | Half day |
| **Total** | **5-6 days** |

---

*This replaces the "spatial topology" vision item. Instead of baking simulation features into the broker, we build a simulation framework on top of the mesh.*
