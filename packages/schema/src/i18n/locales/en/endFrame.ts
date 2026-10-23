export const endFrame = {
  'endFrame.card.first': 'First',
  'endFrame.card.firstShort': 'First',
  'endFrame.card.end': 'End',
  'endFrame.card.action': 'Action',
  'endFrame.card.endFrame': 'End frame',
  'endFrame.history.set': 'Set end frame',
  'endFrame.history.clear': 'Remove end frame',
  'endFrame.error.noShot': "Can't find this shot. It may have been deleted.",
  'endFrame.error.noImage':
    "Can't find that picture in the project. Only pictures already in the project can be used.",
  'endFrame.error.notImage': 'The end frame has to be a picture.',
  'endFrame.gen.noFrame': 'This shot has no first frame yet. Generate the first frame first.',
  'endFrame.gen.noDescription':
    'This shot has no end-frame description yet. Write what the end frame should look like first.',
  'endFrame.gen.noModel':
    'The current picture model cannot take reference pictures. Pick a model marked "Multi-image reference" in Settings.',
  'endFrame.gen.busy':
    'This shot is being generated. Wait until it is done, then generate the end frame.',
  'endFrame.gen.quick':
    'The whole film is being generated. Wait until it is done, then generate the end frame.',
  'endFrame.gen.failed': "The end frame didn't come out. Please try again.",
  'endFrame.tool.generate.done': "Generate the shot's end frame",
  'endFrame.tool.generate.doing': "Generating the shot's end frame…",
  'endFrame.tool.set.done': "Set the shot's end frame",
  'endFrame.tool.set.doing': "Setting the shot's end frame…",
  'endFrame.tool.clear.done': "Remove the shot's end frame",
  'endFrame.tool.clear.doing': "Removing the shot's end frame…",
} as const
