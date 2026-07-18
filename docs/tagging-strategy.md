Each MTG card produces tags which determines its characteristics and effects

example we had with Inalla, Archmage Ritualist

So going from the card itself it should produce

type:creature
type:legendary

subtype:human
subtype:wizard

identity:blue
identity:black
identity:red

color:blue
color:black
color:red

cmc:5
power:4
toughness:5

all of the above are just from looking at a card

If we dig down into the text we can split it into 2 

ability:trigger
trigger:enters
effect:token-generation
token:wizard

which is eminence ability, this ability should produce edges with subtype:wizard and not token 

ability:activated
effect:player-damage

which is the tap five untapped wizards ability, which edges just with subtype:wizard

so from this we have a lot of characteristic tags, and the abilities actually is what edges what actually produces the cares tags which can be used to see what synergizes with what

Going by the example of Kindred Discovery

this is 

type:enchantment
identity:blue
color:blue
cmc:5

it has to part of text:

As this enchantment enters, choose a creature type.

which should determine that we aim for the most represented tribal in the deck

and second one
Whenever a creature you control of the chosen type enters or attacks, draw a card.

so it is:

ability:triggered
trigger:enters 
trigger:attacks
effect:draw-card

and this ability cares about tribal that we have the most represented in the deck

so if you compare those you can see that the effect of Kindred Discovery has direct edge with Inalla cause she is a wizard, but also it edges with eminence ability of Inalla cause it produces wizard tokens, so you can say that it cares about *:wizard and because the eminence ability cares only about subtype:wizard, that means it does not synergize with itself, so there is no infinite loop 