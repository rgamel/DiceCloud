import SimpleSchema from 'simpl-schema';
import ChildSchema from '/imports/api/parenting/ChildSchema.js';
import propertySchemasIndex from '/imports/api/properties/propertySchemasIndex.js';
import Libraries from '/imports/api/library/Libraries.js';
import { assertEditPermission } from '/imports/api/sharing/sharingPermissions.js';
import { softRemove } from '/imports/api/parenting/softRemove.js';
import SoftRemovableSchema from '/imports/api/parenting/SoftRemovableSchema.js';

let LibraryNodes = new Mongo.Collection('libraryNodes');

let LibraryNodeSchema = new SimpleSchema({
	type: {
    type: String,
    allowedValues: Object.keys(propertySchemasIndex),
  },
});

for (let key in propertySchemasIndex){
	let schema = new SimpleSchema({});
	schema.extend(LibraryNodeSchema);
	schema.extend(propertySchemasIndex[key]);
	schema.extend(ChildSchema);
	schema.extend(SoftRemovableSchema);
	LibraryNodes.attachSchema(schema, {
		selector: {type: key}
	});
}

function getLibrary(node){
  if (!node) throw new Meteor.Error('No node provided');
  let library = Libraries.findOne(node.ancestors[0].id);
  if (!library) throw new Meteor.Error('Library does not exist');
  return library;
}

function assertNodeEditPermission(node, userId){
  let lib = getLibrary(node);
  return assertEditPermission(lib, userId);
}

const insertNode = new ValidatedMethod({
  name: 'LibraryNodes.methods.insert',
	validate: null,
  run(libraryNode) {
    assertNodeEditPermission(libraryNode, this.userId);
		return LibraryNodes.insert(libraryNode);
  },
});

const updateLibraryNode = new ValidatedMethod({
  name: 'LibraryNodes.methods.update',
  validate({_id, path, value, ack}){
		if (!_id) return false;
		// We cannot change these with a simple update
		switch (path[0]){
			case 'type':
      case 'order':
      case 'parent':
      case 'ancestors':
				return false;
		}
  },
  run({_id, path, value}) {
    let node = LibraryNodes.findOne(_id);
    assertNodeEditPermission(node, this.userId);
		return LibraryNodes.update(_id, {
			$set: {[path.join('.')]: value},
		}, {
			selector: {type: node.type},
		});
  },
});

const pushToLibraryNode = new ValidatedMethod({
	name: 'LibraryNodes.methods.push',
	validate: null,
	run({_id, path, value}){
		let node = LibraryNodes.findOne(_id);
    assertNodeEditPermission(node, this.userId);
		return LibraryNodes.update(_id, {
			$push: {[path.join('.')]: value},
		}, {
			selector: {type: node.type},
		});
	}
});

const pullFromLibraryNode = new ValidatedMethod({
	name: 'LibraryNodes.methods.pull',
	validate: null,
	run({_id, path, itemId}){
		let node = LibraryNodes.findOne(_id);
    assertNodeEditPermission(node, this.userId);
		return LibraryNodes.update(_id, {
			$pull: {[path.join('.')]: {_id: itemId}},
		}, {
			selector: {type: node.type},
			getAutoValues: false,
		});
	}
});

const softRemoveLibraryNode = new ValidatedMethod({
	name: 'LibraryNodes.methods.softRemove',
	validate: new SimpleSchema({
		_id: SimpleSchema.RegEx.Id
	}).validator(),
	run({_id}){
		let node = LibraryNodes.findOne(_id);
    assertNodeEditPermission(node, this.userId);
		softRemove({_id, collection: LibraryNodes});
	}
});

export default LibraryNodes;
export {
	LibraryNodeSchema,
	insertNode,
	updateLibraryNode,
	pullFromLibraryNode,
	pushToLibraryNode,
	softRemoveLibraryNode,
	libraryNodesToTree,
};
