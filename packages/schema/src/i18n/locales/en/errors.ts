export const errors = {
  'errors.couldnTSaveTheFile': 'Couldn’t save the file. Check that there’s enough disk space.',
  'errors.theDataHasChangedSince':
    'The data has changed since then, so this action can’t be undone.',
  'errors.thisProjectIsAlreadyOpen':
    'This project is already open in another window. Close that window and try again.',
  'errors.couldnTGetAccessTo': 'Couldn’t get access to the project. Please try again in a moment.',
  'errors.thisProjectWasCreatedWith':
    'This project was created with a newer version of Slima Video Studio. Please update the app first.',
  'errors.couldnTUpgradeTheProject':
    'Couldn’t upgrade the project database ({tag}). The original file was not changed.',
  'errors.theProjectFolderNameMust': 'The project folder name must end with {projectDirSuffix}.',
  'errors.aProjectOrFolderWith': 'A project or folder with that name already exists here.',
  'errors.saveAsFailedWhileCopying':
    'Save As failed while copying the project (not enough disk space, or no permission to write?). The original project was not affected.',
  'errors.couldnTFindTheProject':
    'Couldn’t find the project: there’s no project.json in this folder.',
  'errors.projectJsonIsDamagedAnd': 'project.json is damaged and can’t be read.',
  'errors.projectJsonIsnTIn': 'project.json isn’t in the right format.',
  'errors.thereSNoProjectSqlite':
    'There’s no project.sqlite in the project folder; the project may be damaged.',
  'errors.projectJsonAndTheDatabase': 'project.json and the database belong to different projects.',
  'errors.couldnTFindTheProject2': 'Couldn’t find the project. Check the folder location.',
  'errors.couldnTFindThatCharacter': 'Couldn’t find that character ({id}).',
  'errors.thisCharacterHasNoFixed':
    'This character has no fixed appearance description yet. Write one (or ask AI to tidy it up) before locking.',
  'errors.couldnTFindThatVersion': 'Couldn’t find that version.',
  'errors.couldnTFindThatConcept': 'Couldn’t find that concept picture.',
  'errors.couldnTFindThatTurnaround': 'Couldn’t find that turnaround.',
  'errors.couldnTFindThatLocation': 'Couldn’t find that location card.',
  'errors.thisLocationCardIsLocked': 'This location card is locked. Unlock it before editing.',
  'errors.writeDownWhatThisLocation': 'Write down what this location always looks like first.',
  'errors.pickAMainLocationPicture': 'Pick a main location picture first.',
  'errors.couldnTFind': 'Couldn’t find {what} ({id}).',
  'errors.thatAct': 'that act',
  'errors.thatLocation': 'that location',
  'errors.thatScene': 'that scene',
  'errors.theProjectDatabaseHasNo': 'The project database has no project data.',
  'errors.shot': 'shot',
  'errors.theOrderMustIncludeEvery': 'The order must include every shot, without repeats.',
  'errors.version': 'version',
  'errors.musicCoversTheWholeFilm':
    'Music covers the whole film and doesn’t belong to a single shot.',
  'errors.narrationAndSoundEffectsMust': 'Narration and sound effects must belong to a shot.',
  'errors.couldnTFindThatSound': 'Couldn’t find that sound clip.',
  'errors.theStartOffsetCanT': 'The start offset can’t be negative.',
  'errors.theSoundSettingsArenT': 'The sound settings aren’t valid.',
  'errors.thePerRunSpendingLimit': 'the “Per-run spending limit”',
  'errors.theProjectLimit': 'the project limit',
  'errors.raiseThePerRunSpending': 'Raise the “Per-run spending limit” under “Settings → General”',
  'errors.raiseTheLimitInSettings': 'Raise the limit in Settings',
  'errors.estimatedCostIsOverThen':
    'Estimated cost {value} is over {over} ({value2}). {where}, then you can continue from where it stopped (finished steps won’t run again or be charged again).',
  'errors.thereSNoPriceData': 'There’s no price data for “{modelId}”.',
  'errors.forEachItemNeedsA': '“For each item” needs a list as its input.',
  'errors.cancelled': 'Cancelled.',
  'errors.ofItemsFailed': '{value} of {value2} items failed.',
  'errors.aSubWorkflowMustHave':
    'A sub-workflow must have exactly one {inputNode} step (it has {value}).',
  'errors.aSubWorkflowMustHave2':
    'A sub-workflow must have exactly one {outputNode} step (it has {value}).',
  'errors.couldnTFindTheProvider':
    'Couldn’t find the provider “{provider}”. Add it in Settings first.',
  'errors.onlyFailedOrCancelledJobs': 'Only failed or cancelled jobs can be retried.',
  'errors.couldnTFindTheProvider2': 'Couldn’t find the provider.',
  'errors.thisProviderCanTReport': 'This provider can’t report job progress.',
  'errors.anUnexpectedErrorHappenedWhile': 'An unexpected error happened while running the job.',
  'errors.couldnTFindTheJob': 'Couldn’t find the job ({id}).',
  'errors.thisStepFailed': 'This step failed.',
  'errors.theResultOfTheStep':
    'The result of the “{type}” step isn’t in the expected format{value}{value2}.',
  'errors.theMusicIsTooShort':
    'The music is too short to loop to the length of the whole video. Pick a longer track.',
  'errors.couldnTMeasureTheVolume': 'Couldn’t measure the volume.',
  'errors.theStartsAfterTheEnd':
    'The {what} starts after the end of the video. Move its start earlier.',
  'errors.theFileHasNoSound': 'The {what} file has no sound.',
  'errors.theFileToMixHas': 'The file to mix has no picture and can’t be processed.',
  'errors.narration': 'narration',
  'errors.soundEffect': 'sound effect',
  'errors.theMusicFileHasNo': 'The music file has no sound.',
  'errors.theTrimRangeIsnT': 'The trim range isn’t valid.',
  'errors.thereAreNoVideosTo': 'There are no videos to join.',
  'errors.oneOfTheFilesHas':
    'One of the files has no picture, so it can’t be joined into the final film.',
  'errors.theVideoLengthMustBe': 'The video length must be more than 0 seconds.',
  'errors.couldnTReadThisVideo': 'Couldn’t read this video file’s information.',
  'errors.couldnTFindTheVideo': 'Couldn’t find the video tool (FFmpeg). Please reinstall the app.',
  'errors.theVideoToolCouldnT': 'The video tool couldn’t start.',
  'errors.videoProcessingFailedTheFile':
    'Video processing failed. The file may be damaged or in an unsupported format.',
  'errors.theFalAiServiceKey': 'The fal.ai service key isn’t set yet. Enter it in Settings first.',
  'errors.falAiReturnedContentIn':
    'fal.ai returned content in an unexpected format. It will retry automatically.',
  'errors.falAiReturnedAStatus':
    'fal.ai returned a status in an unexpected format. It will retry automatically.',
  'errors.theFileFalAiReturned': 'The file fal.ai returned is too large and was skipped.',
  'errors.imageToVideoNeedsA': 'Image-to-video needs a starting picture.',
  'errors.falAiOnlyHandlesImage': 'fal.ai only handles image and video requests here.',
  'errors.couldnTFindTheFal': 'Couldn’t find the fal.ai endpoint for the model “{modelId}”.',
  'errors.falAiReturnedNoResult':
    'fal.ai returned no result; the content may have been filtered. Adjust the description and try again.',
  'errors.theJobIsMissingIts': 'The job is missing its fal.ai ID.',
  'errors.falAiCouldnTFinish':
    'fal.ai couldn’t finish this job. Adjust the description or pick another model.',
  'errors.theServiceKeyForIs':
    'The service key for {name} is invalid or doesn’t have permission. Enter it again in Settings.',
  'errors.hasRunOutOfBalance': '{name} has run out of balance. Add credit and try again.',
  'errors.tookTooLongToRespond': '{name} took too long to respond. It will retry automatically.',
  'errors.isGettingTooManyRequests':
    '{name} is getting too many requests right now. It will retry automatically.',
  'errors.isTemporarilyUnavailableItWill':
    '{name} is temporarily unavailable. It will retry automatically.',
  'errors.rejectedThisRequestCheckThe':
    '{name} rejected this request. Check the content or pick another model.',
  'errors.couldnTReachCheckYour':
    'Couldn’t reach {name}. Check your network. It will retry automatically.',
  'errors.returnedContentThatCouldnT':
    '{name} returned content that couldn’t be read. It will retry automatically.',
  'errors.couldnTFindTheModel': 'Couldn’t find the model ({id}).',
  'errors.theFileOpenrouterReturnedIs':
    'The file OpenRouter returned is too large and was skipped.',
  'errors.noReasonGiven': 'No reason given',
  'errors.theOpenrouterServiceKeyIsn':
    'The OpenRouter service key isn’t set yet. Enter it in Settings first.',
  'errors.couldnTFindTheOpenrouter':
    'Couldn’t find the OpenRouter equivalent of the model “{modelId}”.',
  'errors.openrouterReturnedContentInAn':
    'OpenRouter returned content in an unexpected format. It will retry automatically.',
  'errors.theModelGaveNoResponse':
    'The model gave no response (the content may have been filtered). Edit the content and try again.',
  'errors.openrouterReturnedNoStreamedContent': 'OpenRouter returned no streamed content.',
  'errors.openrouterReturnedNoPictureThe':
    'OpenRouter returned no picture; the content may have been filtered. Adjust the description and try again.',
  'errors.openrouterDidnTAcceptThis':
    'OpenRouter didn’t accept this narration (the voice name or text length may not be supported by this model). Pick another voice or shorten the text and try again.',
  'errors.openrouterReturnedNoMusicThe':
    'OpenRouter returned no music; the content may have been filtered. Adjust the description and try again.',
  'errors.openrouterDidnTAcceptThis2':
    'OpenRouter didn’t accept this video request (this model may not support first/last frames or reference pictures). Pick another video model and try again.',
  'errors.openrouterReturnedAStatusIn':
    'OpenRouter returned a status in an unexpected format. It will retry automatically.',
  'errors.couldnTReadTheBalance': 'Couldn’t read the balance data OpenRouter returned.',
  'errors.openrouterReceivedARequestIn': 'OpenRouter received a request in an invalid format.',
  'errors.thisNarrationModelNeedsA': 'This narration model needs a voice. Pick one in Settings.',
  'errors.onlyVideoJobsNeedPolling': 'Only video jobs need polling on OpenRouter.',
  'errors.openrouterCouldnTFinishThis':
    'OpenRouter couldn’t finish this video. Adjust the description or pick another model.',
  'errors.theNameCanTBe': 'The name can’t be empty',
  'errors.thereSNothingToChange': 'There’s nothing to change',
  'errors.theNameCanTBe2': 'The name can’t be longer than 100 characters',
  'errors.theFileIsEmpty': 'The file is empty',
  'errors.theFileIsTooLarge':
    'The file is too large (over 200 MB). Use “Upload” to pick a file instead',
  'errors.aCharacterNeedsAName': 'A character needs a name',
  'errors.theNameCanTBe3': 'The name can’t be longer than 40 characters',
  'errors.theTwoCutLinesMust': 'The two cut lines must be some distance apart',
  'errors.pasteTheTextToSplit': 'Paste the text to split into scenes first',
  'errors.musicCoversTheWholeFilm2':
    'Music covers the whole film and doesn’t belong to a single shot.',
  'errors.narrationAndSoundEffectsMust2': 'Narration and sound effects must belong to a shot.',
  'errors.aCastMemberNeedsA': 'A cast member needs a characterId or a name',
  'errors.theProviderIdIsnT': 'The provider ID isn’t in the right format',
  'errors.slimaDidnTAcceptThis':
    'Slima didn’t accept this token (it may be mistyped, expired or revoked). Generate a new one in Slima.',
  'errors.connectingToSlima': 'Connecting to Slima…',
  'errors.theConnectionToSlimaWas': 'The connection to Slima was lost. Reconnecting…',
  'errors.couldnTReachSlimaCheck':
    'Couldn’t reach Slima. Check your network; it will retry automatically.',
  'errors.disconnected': 'Disconnected.',
  'errors.theSlimaToolIsnT': 'The Slima tool “{name}” isn’t one of the allowed read-only tools.',
  'errors.theSlimaTokenIsnT': 'The Slima token isn’t set yet. Connect in Settings first.',
  'errors.notConnectedToSlimaYet': 'Not connected to Slima yet. Please try again in a moment.',
  'errors.slimaDidnTRespondPlease': 'Slima didn’t respond. Please try again in a moment.',
  'errors.slimaIsGettingTooMany':
    'Slima is getting too many requests. Wait a few seconds and try again.',
  'errors.slimaReportedAnErrorPlease': 'Slima reported an error. Please try again in a moment.',
  'errors.theTextIsTooLong': 'The text is too long. Keep it within {value} characters',
} as const
