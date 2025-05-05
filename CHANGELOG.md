# Change Log

All notable changes to the "Agentic Wiki" extension will be documented in this file.

## [0.1.1] - 2025-05-05

### Performance

- Implemented fully asynchronous file crawling to prevent blocking the main thread
- Added incremental file processing to avoid reprocessing unchanged files
- Implemented streaming file processing to reduce memory usage with large repositories
- Added workspace-specific file hash caching for better performance across projects
- Improved progress reporting with detailed file processing status

### Improved

- Enhanced cancellation support throughout the file processing pipeline
- Added non-blocking cache initialization to improve extension startup time
- Implemented automatic cleanup of old cache entries
- Added batch processing for large file sets to prevent memory issues
- Improved error handling and recovery during file processing

## [0.1.0] - 2025-05-04

### Added

- Added model selection capability for OpenRouter API
- Added automatic fetching of available models from OpenRouter API
- Added guidance on how to create an OpenRouter API key in the configuration UI
- Implemented model sorting to prioritize free models in the selection list

### Improved

- Enhanced LLM configuration user experience with a more intuitive interface
- Improved API key input field with better descriptions and guidance
- Updated all nodes to use the selected model when calling the LLM service
- Added proper model fallback mechanism when no model is selected
- Standardized language handling with ISO language codes instead of native language names
- Improved multi-language support with better handling of non-Latin scripts
- Enhanced language processing for Chinese and other non-English languages

### Technical

- Added model-related types and interfaces to support model selection
- Added OpenRouter-related constants for better code organization
- Updated flow parameters to include model selection
- Implemented language code mapping system for more consistent language processing
- Added native language names alongside English names in LLM prompts for better understanding

## [0.1.0-alpha] - 2025-05-04

### Improved

- Completely restructured the codebase with a service-oriented architecture
- Created dedicated services for cache, LLM, file operations, logging, and configuration
- Implemented asynchronous cache operations to prevent blocking the main thread
- Added proper error handling and logging throughout the codebase
- Improved code organization for better maintainability and open-source contributions

### Fixed

- Fixed cache handling with proper file locking mechanism to prevent race conditions
- Implemented atomic file operations for cache to ensure data integrity
- Ensured cache directory is properly created before use
- Added workspace-specific cache considerations to todo list
- Fixed markdown preview to first check for Markdown Preview Enhanced and fall back to VS Code's built-in preview if needed

### Technical

- Moved from synchronous to asynchronous file operations
- Implemented lazy initialization for cache to improve extension startup time
- Created a unified logging service with different log levels
- Centralized configuration management

### Security

- Implemented secure API key storage using VS Code's Secret Storage API
- Added automatic migration of existing API keys from global state to secure storage
- Removed API key from shared state to prevent exposure

## [0.0.3] - 2025-05-03

### Security

- Implemented secure API key storage using VS Code's Secret Storage API
- Added automatic migration of existing API keys from global state to secure storage
- Removed API key from shared state to prevent exposure

### Code Quality

- Refactored duplicate code into utility functions for language handling and file formatting
- Updated language dropdown in configuration UI to make English the default first option
- Improved error messages for missing or invalid API keys

## [0.0.2] - 2025-05-03

### Added

- Support for multiple languages in generated documentation
- Improved caching mechanism for LLM responses
- Enhanced error handling for API calls

## [0.0.1] - 2025-05-03

### Added

- Initial release
- Configuration panel functionality
- Wiki generation feature
- Wiki viewing capability

## [Unreleased]

### Planned

- Enhanced error handling
- Visualization flow improvements
- Implement dependency injection pattern
- Add comprehensive unit tests
- Create dedicated API service
- Add detailed API documentation
- Implement optional telemetry
