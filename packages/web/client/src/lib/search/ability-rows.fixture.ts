// Real `tags.abilities` of five cards, copied from the cards/*.json shards of a DERIVE 554 static build (#1786 fixtures; trimmed to the abilities).
export const ABILITIES: Record<string, readonly Record<string, unknown>[]> = {
 "Sylvan Library": [
  {
   "kind": "triggered",
   "effect": {
    "kind": "draw-card",
    "subject": {
     "control": "you",
     "token": null
    }
   },
   "amount": "2",
   "emits": [
    {
     "verb": "draw",
     "subject": {
      "control": "you",
      "token": null
     }
    }
   ],
   "clause": 1,
   "repeats": "per-cycle",
   "count": {
    "floor": 2,
    "ceiling": 2
   }
  },
  {
   "kind": "triggered",
   "effect": {
    "kind": ""
   },
   "amount": "4",
   "emits": [
    {
     "verb": "lose-life",
     "subject": {
      "control": "you",
      "token": null
     }
    }
   ],
   "clause": 1,
   "repeats": "per-cycle",
   "count": {
    "floor": 4,
    "ceiling": 4
   }
  },
  {
   "kind": "triggered",
   "effect": {
    "kind": "top-set",
    "subject": {
     "control": "any",
     "token": null
    }
   },
   "clause": 1,
   "repeats": "per-cycle"
  }
 ],
 "Viscera Seer": [
  {
   "kind": "activated",
   "effect": {
    "kind": ""
   },
   "cost": "Sacrifice a creature",
   "amount": "1",
   "emits": [
    {
     "verb": "sacrifice",
     "subject": {
      "control": "you",
      "token": null,
      "type": "creature"
     },
     "instantSpeed": true
    },
    {
     "verb": "dies",
     "subject": {
      "control": "you",
      "token": null,
      "type": "creature"
     },
     "instantSpeed": true
    }
   ],
   "clause": 1,
   "repeats": "repeatable",
   "count": {
    "floor": 1,
    "ceiling": 1
   },
   "payment": {
    "sacrifice": [
     {
      "amount": "1",
      "subject": {
       "control": "you",
       "token": null,
       "type": "creature"
      }
     }
    ]
   }
  },
  {
   "kind": "activated",
   "effect": {
    "kind": "scry",
    "subject": {
     "control": "you",
     "token": null
    }
   },
   "cost": "Sacrifice a creature",
   "amount": "1",
   "emits": [
    {
     "verb": "scry",
     "subject": {
      "control": "you",
      "token": null
     },
     "instantSpeed": true
    }
   ],
   "clause": 1,
   "repeats": "repeatable",
   "count": {
    "floor": 1,
    "ceiling": 1
   },
   "payment": {
    "sacrifice": [
     {
      "amount": "1",
      "subject": {
       "control": "you",
       "token": null,
       "type": "creature"
      }
     }
    ]
   }
  }
 ],
 "Skullclamp": [
  {
   "kind": "static",
   "effect": {
    "kind": "pump"
   },
   "host": true,
   "amount": "+1/-1",
   "clause": 1,
   "repeats": "continuous"
  },
  {
   "kind": "triggered",
   "effect": {
    "kind": "draw-card",
    "subject": {
     "control": "you",
     "token": null
    }
   },
   "trigger": {
    "verbs": [
     "dies"
    ],
    "subject": {
     "control": "you",
     "token": null,
     "type": "creature"
    },
    "host": true
   },
   "amount": "2",
   "emits": [
    {
     "verb": "draw",
     "subject": {
      "control": "you",
      "token": null
     }
    }
   ],
   "clause": 2,
   "repeats": "per-cycle",
   "count": {
    "floor": 2,
    "ceiling": 2
   }
  }
 ],
 "Phyrexian Arena": [
  {
   "kind": "triggered",
   "effect": {
    "kind": "draw-card",
    "subject": {
     "control": "you",
     "token": null
    }
   },
   "trigger": {
    "verbs": [
     "upkeep"
    ],
    "subject": {
     "control": "you",
     "token": null
    }
   },
   "amount": "1",
   "emits": [
    {
     "verb": "draw",
     "subject": {
      "control": "you",
      "token": null
     }
    }
   ],
   "clause": 1,
   "repeats": "per-cycle",
   "count": {
    "floor": 1,
    "ceiling": 1
   }
  },
  {
   "kind": "triggered",
   "effect": {
    "kind": ""
   },
   "trigger": {
    "verbs": [
     "upkeep"
    ],
    "subject": {
     "control": "you",
     "token": null
    }
   },
   "amount": "1",
   "emits": [
    {
     "verb": "lose-life",
     "subject": {
      "control": "you",
      "token": null
     }
    }
   ],
   "clause": 1,
   "repeats": "per-cycle",
   "count": {
    "floor": 1,
    "ceiling": 1
   }
  }
 ],
 "Mulldrifter": [
  {
   "kind": "triggered",
   "effect": {
    "kind": "draw-card",
    "subject": {
     "control": "you",
     "token": null
    }
   },
   "trigger": {
    "verbs": [
     "enters"
    ],
    "subject": {
     "control": "you",
     "token": null,
     "type": "creature",
     "self": true
    }
   },
   "amount": "2",
   "emits": [
    {
     "verb": "draw",
     "subject": {
      "control": "you",
      "token": null
     }
    }
   ],
   "clause": 2,
   "repeats": "once",
   "count": {
    "floor": 2,
    "ceiling": 2
   }
  }
 ]
};
