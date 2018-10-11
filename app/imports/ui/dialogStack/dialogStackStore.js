import store from "/imports/ui/vuexStore.js";

const offset = 16;
const duration = 400;
let dialogStack = {};
dialogStack.dialogs = [];

const dialogStackStore = {
  state: {
    dialogs: [],
  },
  mutations: {
    pushDialogStack(state, {component, data, element, returnElement, callback}){
      // Generate a new _id so that Vue knows how to shuffle the array
      const _id = Random.id();
      state.dialogs.push({
        _id,
        component,
        data,
        element,
        returnElement,
        callback,
      });
      updateHistory();
    },
    popDialogStackMutation (state, result){
      const dialog = state.dialogs.pop();
      updateHistory();
      if (!dialog) return;
      dialog.callback && dialog.callback(result);
    },
  },
  actions: {
    popDialogStack(context, result){
      if (history && history.state && history.state.openDialogs){
        history.back();
      } else {
        context.commit("popDialogStackMutation", result)
      }
    }
  }
};

export default dialogStackStore;

const updateHistory = function(){
  // history should looks like: [{openDialogs: 0}, {openDialogs: n}] where
  // n is the number of open dialogs

  // If we can't access the history object, give up
  if (!history) return;
  // Make sure that there is a state tracking open dialogs
  // replace the state without bashing it in the process
  if (!history.state || !_.isFinite(history.state.openDialogs)){
    let newState = _.clone(history.state)  || {};
    newState.openDialogs = 0;
    history.replaceState(newState, "");
  }

  const numDialogs = dialogStackStore.state.dialogs.length;
  const stateDialogs = history.state.openDialogs;

  // If the number of dialogs and state dialogs are equal, we don't need to do
  // anything
  if (numDialogs === stateDialogs) return;

  if (stateDialogs > 0){
    // On a dialog count
    if (numDialogs === 0){
      // but shouldn't be
      history.back();
    } else {
      // but should replace with correct count
      let newState = _.clone(history.state) || {};
      newState.openDialogs = dialogStackStore.state.dialogs.length;
      history.replaceState(newState, "");
    }
  } else if (numDialogs > 0 && stateDialogs === 0){
    // On the zero state, push a dialog count
    history.pushState({openDialogs: numDialogs}, "");
  } else {
    console.warn(
      "History could not be updated correctly, unexpected case",
      {stateDialogs, numDialogs},
    )
  }
};