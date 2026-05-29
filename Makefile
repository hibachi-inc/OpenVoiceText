OSS_DIR = OpenVoiceText
BUILD_DIR = .build/debug
APP_BUNDLE = $(BUILD_DIR)/OpenVoiceText-Pro.app

.PHONY: build bundle run clean

build:
	cd $(OSS_DIR) && swift build
	swift build

bundle: build
	# Copy OSS app bundle as base
	rm -rf "$(APP_BUNDLE)"
	cp -R "$(OSS_DIR)/.build/debug/VoiceFlow.app" "$(APP_BUNDLE)"
	cp "$(OSS_DIR)/Resources/Info.plist" "$(APP_BUNDLE)/Contents/"

	# Copy OSS STT XPC (unchanged)
	mkdir -p "$(APP_BUNDLE)/Contents/XPCServices/com.hibachi.voiceflow.stt.xpc/Contents/MacOS"
	cp "$(OSS_DIR)/.build/debug/VoiceFlowSTT" "$(APP_BUNDLE)/Contents/XPCServices/com.hibachi.voiceflow.stt.xpc/Contents/MacOS/VoiceFlowSTT"
	cp "$(OSS_DIR)/Resources/STT-Info.plist" "$(APP_BUNDLE)/Contents/XPCServices/com.hibachi.voiceflow.stt.xpc/Contents/Info.plist"

	# Replace Refiner XPC with Pro version
	mkdir -p "$(APP_BUNDLE)/Contents/XPCServices/com.hibachi.voiceflow.refiner.xpc/Contents/MacOS"
	cp "$(BUILD_DIR)/ProRefiner" "$(APP_BUNDLE)/Contents/XPCServices/com.hibachi.voiceflow.refiner.xpc/Contents/MacOS/ProRefiner"
	cp "ProResources/Refiner-Info.plist" "$(APP_BUNDLE)/Contents/XPCServices/com.hibachi.voiceflow.refiner.xpc/Contents/Info.plist"

	# Ad-hoc sign
	codesign --force --sign - "$(APP_BUNDLE)/Contents/XPCServices/com.hibachi.voiceflow.stt.xpc"
	codesign --force --sign - "$(APP_BUNDLE)/Contents/XPCServices/com.hibachi.voiceflow.refiner.xpc"
	codesign --force --sign - "$(APP_BUNDLE)"

run: bundle
	open "$(APP_BUNDLE)"

clean:
	swift package clean
	cd $(OSS_DIR) && swift package clean
	rm -rf "$(APP_BUNDLE)"
