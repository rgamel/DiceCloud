// TODO allow abilities to get advantage/disadvantage, making all skills that are based
// on them disadvantaged as well

import { ValidatedMethod } from 'meteor/mdg:validated-method';
import SimpleSchema from 'simpl-schema';
import schema from '/imports/api/schema.js';
import { canEditCreature } from '/imports/api/creature/creaturePermission.js';
import Creatures from "/imports/api/creature/Creatures.js";
import Attributes from "/imports/api/creature/properties/Attributes.js";
import Skills from "/imports/api/creature/properties/Skills.js";
import Effects from "/imports/api/creature/properties/Effects.js";
import DamageMultipliers from "/imports/api/creature/properties/DamageMultipliers.js";
import Classes from "/imports/api/creature/properties/Classes.js";

export const recomputeCreature = new ValidatedMethod({

  name: "Creatures.methods.recomputeCreature",

  validate: schema({
    charId: { type: String }
  }).validator(),

  run({charId}) {
    // Permission
    if (!canEditCreature(charId, this.userId)) {
      throw new Meteor.Error('Creatures.methods.recomputeCreature.denied',
      'You do not have permission to recompute this creature');
    }

    // Work, call this direcly if you are already in a method that has checked
    // for permission to edit a given character
    recomputeCreatureById(charId);

  },

});

 /**
  * This function is the heart of DiceCloud. It recomputes a creature's stats,
  * distilling down effects and proficiencies into the final stats that make up
  * a creature.
  *
  * Essentially this is a depth first tree traversal algorithm that computes
  * stats' dependencies before computing stats themselves, while detecting
  * dependency loops.
  *
  * At the moment it makes no effort to limit recomputation to just what was
  * changed.
  *
  * Attempting to implement dependency management to limit recomputation to just
  * change affected stats should only happen as a last resort, when this function
  * can no longer be performed more efficiently, and server resources can not be
  * expanded to meet demand.
  *
  * A brief overview:
  * - Fetch the stats of the creature and add them to
  *   an object for quick lookup
  * - Fetch the effects and proficiencies which apply to each stat and store them with the stat
  * - Fetch the class levels and store them as well
  * - Mark each stat and effect as uncomputed
  * - Iterate over each stat in order and compute it
  *   - If the stat is already computed, skip it
  *   - If the stat is busy being computed, we are in a dependency loop, make it NaN and mark computed
  *   - Mark the stat as busy computing
  *   - Iterate over each effect which applies to the attribute
  *     - If the effect is not computed compute it
  *       - If the effect relies on another attribute, get its computed value
  *       - Recurse if that attribute is uncomputed
  *     - apply the effect to the attribute
  *   - Conglomerate all the effects to compute the final stat values
  *   - Mark the stat as computed
  * - Write the computed results back to the database
  *
  * @param  {String} charId the Id of the creature to compute
  * @returns {Object}       An in-memory description of the character as
  *                         computed and written to the database
  */
export function recomputeCreatureById(charId){
  let char = buildCreature(charId);
  char = computeCreature(char);
  writeCreature(char);
  return char;
};

/**
 * Write the in-memory creature to the database docs
 * This could be optimized to only write changed fields to the database
 *
 * @param  {Object} char in-memory char object
 * @returns {undefined}
 */
function writeCreature(char) {
  writeAttributes(char);
  writeSkills(char);
  writeDamageMultipliers(char);
  writeEffects(char);
  Creatures.update(char.id, {$set: {level: char.level}});
};

/*
 * Write all the attributes from the in-memory char object to the Attirbute docs
 */

/**
 * writeAttributes - description
 *
 * @param  {type} char description
 * @returns {type}      description
 */
function writeAttributes(char) {
  let bulkWriteOps =  _.map(char.atts, (att, variableName) => {
    let op = {
      updateMany: {
        filter: {charId: char.id, variableName},
        update: {$set: {
          value: att.result,
        }},
      }
    }
    if (typeof att.mod === 'number'){
      op.updateMany.update.$set.mod = att.mod;
    }
    return op;
  });
  if (Meteor.isServer){
    Attributes.rawCollection().bulkWrite(bulkWriteOps, {ordered : false}, function(e, r){
      if (e) console.warn(JSON.stringify(e, null, 2))
    });
  } else {
    _.each(bulkWriteOps, op => {
      Attributes.update(op.updateMany.filter, op.updateMany.update, {multi: true});
    });
  }
};

function writeEffects(char){
  let bulkWriteOps =  _.map(char.computedEffects, effect => ({
    updateOne: {
      filter: {_id: effect._id},
      update: {$set: {
        result: effect.result,
      }},
    },
  }));
  if (Meteor.isServer){
    Effects.rawCollection().bulkWrite(bulkWriteOps, {ordered : false}, function(e, r){
      if (e) console.warn(JSON.stringify(e, null, 2))
    });
  } else {
    _.each(bulkWriteOps, op => {
      Effects.update(op.updateOne.filter, op.updateOne.update);
    });
  }
}

/**
 * Write all the skills from the in-memory char object to the Skills docs
 *
 * @param  {type} char description
 * @returns {type}      description
 */
function writeSkills(char) {
  let bulkWriteOps =  _.map(char.skills, (skill, variableName) => {
    let op = {
      updateMany: {
        filter: {charId: char.id, variableName},
        update: {$set: {
          value: skill.result,
          advantage: skill.advantage,
          passiveBonus: skill.passiveAdd,
          proficiency: skill.proficiency,
          conditionalBenefits: skill.conditional,
          fail: skill.fail,
        }},
      }
    }
    return op;
  });
  if (Meteor.isServer){
    Skills.rawCollection().bulkWrite( bulkWriteOps, {ordered : false}, function(e, r){
      if (e) console.warn(JSON.stringify(e, null, 2))
    });
  } else {
    _.each(bulkWriteOps, op => {
      Skills.update(op.updateMany.filter, op.updateMany.update, {multi: true});
    });
  }
};

 /**
  * Write all the damange multipliers from the in-memory char object to the docs
  *
  * @param  {type} char description
  * @returns {type}      description
  */
function writeDamageMultipliers(char) {
  let bulkWriteOps =  _.map(char.dms, (dm, variableName) => {
    let op = {
      updateMany: {
        filter: {charId: char.id, variableName},
        update: {$set: {
          value: dm.result,
        }},
      }
    }
    return op;
  });
  if (Meteor.isServer){
    DamageMultipliers.rawCollection().bulkWrite( bulkWriteOps, {ordered : false}, function(e, r){
      if (e) console.warn(JSON.stringify(e, null, 2))
    });
  } else {
    _.each(bulkWriteOps, op => {
      DamageMultipliers.update(op.updateMany.filter, op.updateMany.update, {multi: true});
    });
  }
};


 /**
  * Get the creature's data from the database and build an in-memory model that
  * can be computed. Hits 6 database collections with indexed queries.
  *
  * @param  {type} charId description
  * @returns {type}        description
  */
function buildCreature(charId){
  let char = {
    id: charId,
    atts: {},
    skills: {},
    dms: {},
    classes: {},
    otherEffects: [],
    computedEffects: [],
    level: 0,
  };
  // Fetch the attributes of the creature and add them to an object for quick lookup
  Attributes.find({charId}).forEach(attribute => {
    if (!char.atts[attribute.variableName]){
      char.atts[attribute.variableName] = {
        computed: false,
        busyComputing: false,
        type: "attribute",
        attributeType: attribute.type,
        base: attribute.baseValue || 0,
        decimal: attribute.decimal,
        result: 0,
        mod: 0, // The resulting modifier if this is an ability
        add: 0,
        mul: 1,
        min: Number.NEGATIVE_INFINITY,
        max: Number.POSITIVE_INFINITY,
        effects: [],
      };
    }
  });

  // Fetch the skills of the creature and store them
  Skills.find({charId}).forEach(skill => {
    if (!char.skills[skill.variableName]){
      char.skills[skill.variableName] = {
        computed: false,
        busyComputing: false,
        type: "skill",
        ability: skill.ability,
        base: skill.baseValue || 0,
        result: 0, // For skills the result is the skillMod
        proficiency: skill.baseProficiency || 0,
        add: 0,
        mul: 1,
        min: Number.NEGATIVE_INFINITY,
        max: Number.POSITIVE_INFINITY,
        advantage: 0,
        disadvantage: 0,
        passiveAdd: 0,
        fail: 0,
        conditional: 0,
        effects: [],
        proficiencies: [],
      };
    }
  });

  // Fetch the damage multipliers of the creature and store them
  DamageMultipliers.find({charId}).forEach(damageMultiplier =>{
    if (!char.dms[damageMultiplier.variableName]){
      char.dms[damageMultiplier.variableName] = {
        computed: false,
        busyComputing: false,
        type: "damageMultiplier",
        result: 0,
        immunityCount: 0,
        ressistanceCount: 0,
        vulnerabilityCount: 0,
        effects: [],
      };
    }
  });

  // Fetch the class levels and store them
  // don't use the word "class" it's reserved
  Classes.find({charId}).forEach(cls => {
    const strippedCls = cls.name.replace(/\s+/g, '');
    if (!char.classes[strippedCls]){
      char.classes[strippedCls] = {level: cls.level};
      char.level += cls.level;
    }
  });

  // Fetch the effects which apply to each stat and store them under the attribute
  Effects.find({
    charId: charId,
    enabled: true,
  }).forEach(effect => {
    let storedEffect = {
      _id: effect._id,
      computed: false,
      result: 0,
      operation: effect.operation,
      calculation: effect.calculation,
    }
    if (char.atts[effect.stat]) {
      char.atts[effect.stat].effects.push(storedEffect);
    } else if (char.skills[effect.stat]) {
      char.skills[effect.stat].effects.push(storedEffect);
    } else if (char.dms[effect.stat]) {
      char.dms[effect.stat].effects.push(storedEffect);
    } else {
      char.otherEffects.push(storedEffect);
    }
  });

  // Fetch the proficiencies and store them under each skill
  Proficiencies.find({
    charId: charId,
    enabled: true,
    type: {$in: ["skill", "save"]}
  }).forEach(proficiency => {
    if (char.skills[proficiency.name]) {
      char.skills[proficiency.name].proficiencies.push(effect);
    }
  });
  return char;
};


/**
 *  Compute the creature's stats in-place, returns the same char object
 * @param  {type} char description
 * @returns {type}      description
 */
export function computeCreature(char){
  // Iterate over each stat in order and compute it
  let statName;
  for (statName in char.atts){
    let stat = char.atts[statName]
    computeStat (stat, char);
  }
  for (statName in char.skills){
    let stat = char.skills[statName]
    computeStat (stat, char);
  }
  for (statName in char.dms){
    let stat = char.dms[statName]
    computeStat (stat, char);
  }
  for (let effect of char.otherEffects){
    computeEffect(effect, char);
  }
  return char;
};


/**
 * Compute a single stat on a creature
 *
 * @param  {type} stat description
 * @param  {type} char description
 * @returns {type}      description
 */
function computeStat(stat, char){
  // If the stat is already computed, skip it
  if (stat.computed) return;

  // If the stat is busy being computed, make it NaN and mark computed
  if (stat.busyComputing){
    // Trying to compute this stat again while it is already computing.
    // We must be in a dependency loop.
    stat.computed = true;
    stat.result = NaN;
    stat.busyComputing = false;
    return;
  }

  // Iterate over each effect which applies to the stat
  for (i in stat.effects){
    computeEffect(stat.effects[i], char);
    // apply the effect to the stat
    applyEffect(stat.effects[i], stat);
  }

  // Conglomerate all the effects to compute the final stat values
  combineStat(stat, char);

  // Mark the attribute as computed
  stat.computed = true;
  stat.busyComputing = false;
}

 /**
  * const computeEffect - Compute a single effect on a creature
  *
  * @param  {Object} effect The effect to compute
  * @param  {Object} char   The char document to compute with
  * @returns {undefined}        description
  */
function computeEffect(effect, char){
  if (effect.computed) return;
  if (_.isFinite(effect.calculation)){
		effect.result = +effect.calculation;
	} else if(effect.operation === "conditional"){
    effect.result = effect.calculation;
  } else if(_.contains(["advantage", "disadvantage", "fail"], effect.operation)){
    effect.result = 1;
  } else if (_.isString(effect.calculation)){
		effect.result = evaluateCalculation(effect.calculation, char);
	}
  effect.computed = true;
  char.computedEffects.push(effect);
};


/**
 * Apply a computed effect to its stat
 *
 * @param  {type} effect description
 * @param  {type} stat   description
 * @returns {type}        description
 */
function applyEffect(effect, stat){
  // Take the largest base value
  if (effect.operation === "base"){
    if (!_.has(stat, "base")) return;
    stat.base = effect.result > stat.base ? effect.result : stat.base;
  }
  // Add all adds together
  else if (effect.operation === "add"){
    if (!_.has(stat, "add")) return;
    stat.add += effect.result;
  }
  else if (effect.operation === "mul"){
    if (!_.has(stat, "mul")) return;
    stat.mul *= effect.result;
  }
  // Take the largest min value
  if (effect.operation === "min"){
    if (!_.has(stat, "min")) return;
    stat.min = effect.result > stat.min ? effect.result : stat.min;
  }
  // Take the smallest max value
  if (effect.operation === "max"){
    if (!_.has(stat, "max")) return;
    stat.max = effect.result < stat.max ? effect.result : stat.max;
  }
  // Sum number of advantages
  else if (effect.operation === "advantage"){
    if (!_.has(stat, "advantage")) return;
    stat.advantage++;
  }
  // Sum number of disadvantages
  else if (effect.operation === "disadvantage"){
    if (!_.has(stat, "disadvantage")) return;
    stat.disadvantage++;
  }
  // Add all passive adds together
  else if (effect.operation === "passiveAdd"){
    if (!_.has(stat, "passiveAdd")) return;
    stat.passiveAdd += effect.result;
  }
  // Sum number of fails
  else if (effect.operation === "fail"){
    if (!_.has(stat, "fail")) return;
    stat.fail++;
  }
  // Sum number of conditionals
  else if (effect.operation === "conditional"){
    if (!_.has(stat, "conditional")) return;
    stat.conditional++;
  }
};


/**
 * Combine the results of multiple effects to get the result of the stat
 *
 * @param  {type} stat description
 * @param  {type} char description
 * @returns {type}      description
 */
function combineStat(stat, char){
  if (stat.type === "attribute"){
    combineAttribute(stat, char)
  } else if (stat.type === "skill"){
    combineSkill(stat, char)
  } else if (stat.type === "damageMultiplier"){
    combineDamageMultiplier(stat, char);
  }
}


/**
 * combineAttribute - Combine attributes's results into final values
 *
 * @param  {type} stat description
 * @param  {type} char description
 * @returns {type}      description
 */
function combineAttribute(stat, char){
  stat.result = (stat.base + stat.add) * stat.mul;
  if (stat.result < stat.min) stat.result = stat.min;
  if (stat.result > stat.max) stat.result = stat.max;
  // Round everything that isn't the carry multiplier
  if (!stat.decimal) stat.result = Math.floor(stat.result);
  if (stat.attributeType === "ability") {
    stat.mod = Math.floor((stat.result - 10) / 2);
  }
}


/**
 * combineSkill - Combine skills results into final values
 *
 * @param  {type} stat description
 * @param  {type} char description
 * @returns {type}      description
 */
function combineSkill(stat, char){
  for (i in stat.proficiencies){
    let prof = stat.proficiencies[i];
    if (prof.value > stat.proficiency) stat.proficiency = prof.value;
  }
  let profBonus;
  if (char.skills.proificiencyBonus){
    if (!char.skills.proficiencyBonus.computed){
      computeStat(char.skills.proficiencyBonus, char);
    }
    profBonus = char.skills.proficiencyBonus.result;
  } else {
    profBonus = Math.floor(char.level / 4 + 1.75);
  }
  profBonus *= stat.proficiency;
  // Skills are based on some ability Modifier
  let abilityMod = 0;
  if (stat.ability && char.atts[stat.ability]){
    if (!char.atts[stat.ability].computed){
      computeStat(char.atts[stat.ability], char);
    }
    abilityMod = char.atts[stat.ability].mod;
  }
  stat.result = (abilityMod + profBonus + stat.add) * stat.mul;
  if (stat.result < stat.min) stat.result = stat.min;
  if (stat.result > stat.max) stat.result = stat.max;
  stat.result = Math.floor(stat.result);
  if (stat.base > stat.result) stat.result = stat.base;
}

/**
 * combineDamageMultiplier - Combine damageMultiplier's results into final values
 *
 * @param  {type} stat description
 * @param  {type} char description
 * @returns {type}      description
 */
function combineDamageMultiplier(stat, char){
  if (stat.immunityCount) return 0;
  if (stat.ressistanceCount && !stat.vulnerabilityCount){
    stat.result = 0.5;
  }  else if (!stat.ressistanceCount && stat.vulnerabilityCount){
    stat.result = 2;
  } else {
    stat.result = 1;
  }
}


/**
 * evaluateCalculation - Evaluate a string computation in the context of  a char
 *
 * @param  {type} string description
 * @param  {type} char   description
 * @returns {type}        description
 */
function evaluateCalculation(string, char){
  if (!string) return string;
  // Replace all the string variables with numbers if possible
  string = string.replace(/\w*[a-z]\w*/gi, function(sub){
    // Attributes
    if (char.atts[sub]){
      if (!char.atts[sub].computed){
        computeStat(char.atts[sub], char);
      }
      return char.atts[sub].result;
    }
    // Modifiers
    if (/^\w+mod$/i.test(sub)){
      var slice = sub.slice(0, -3);
      if (char.atts[slice]){
        if (!char.atts[slice].computed){
          computeStat(char.atts[sub], char);
        }
        return char.atts[slice].mod;
      }
    }
    // Skills
    if (char.skills[sub]){
      if (!char.skills[sub].computed){
        computeStat(char.skills[sub], char);
      }
      return char.skills[sub].result;
    }
    // Damage Multipliers
    if (char.dms[sub]){
      if (!char.dms[sub].computed){
        computeStat(char.dms[sub], char);
      }
      return char.dms[sub].result;
    }
    // Class levels
    if (/^\w+levels?$/i.test(sub)){
      //strip out "level(s)"
      var className = sub.replace(/levels?$/i, "");
      return char.classes[className] && char.classes[className].level;
    }
    // Creature level
    if (sub  === "level"){
      return char.level;
    }
    // Give up
    return sub;
  });

  // Evaluate the expression to a number or return it as is.
  try {
    var result = math.eval(string); // math.eval is safe
    return result;
  } catch (e){
    return string;
  }
};



/**
 * recompute a character's XP from a given id
 */
export const recomputeCreatureXP = new ValidatedMethod({
  name: "Creatures.methods.recomputeCreatureXP",

  validate: schema({
    charId: { type: String }
  }).validator(),

  run({charId}) {
    if (!canEditCreature(charId, this.userId)) {
      // Throw errors with a specific error code
      throw new Meteor.Error("Creatures.methods.recomputeCreatureXP.denied",
      "You do not have permission to recompute this creature's XP");
    }
    var xp = 0;
		Experiences.find(
			{charId: charId},
			{fields: {value: 1}}
		).forEach(function(e){
			xp += e.value;
		});

    Creatures.update(charId, {$set: {xp}})
		return xp;
  },
});


/**
 * Recompute a character's weight carried from a given id
 */
export const recomputeCreatureWeightCarried = new ValidatedMethod({
  name: "Creature.methods.recomputeCreatureWeightCarried",

  validate: schema({
    charId: { type: String }
  }).validator(),

  run({charId}){
    if (!canEditCreature(charId, this.userId)) {
      // Throw errors with a specific error code
      throw new Meteor.Error("Creatures.methods.recomputeCreatureWeightCarried.denied",
      "You do not have permission to recompute this creature's carried weight");
    }
    var weightCarried = 0;
    // store a dictionary of carried containers
    var carriedContainers = {};
    Containers.find(
      {
        charId,
        isCarried: true,
      },
      { fields: {
        isCarried: 1,
        weight: 1,
      }}
    ).forEach(container => {
      carriedContainers[container._id] = true;
      weightCarried += container.weight;
    });
    Items.find(
      {
        charId,
      },
      { fields: {
        weight: 1,
        parent: 1,
      }}
    ).forEach(item => {
      // if the item is carried/equiped or in a carried container, add its weight
      if (parent.id === charId || carriedContainers[parent.id]){
        weightCarried += item.weight;
      }
    });

    Creatures.update(charId, {$set: {weightCarried}})
    return weightCarried;
  }
});