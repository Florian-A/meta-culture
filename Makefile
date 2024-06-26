NAME = metaculture

all: $(NAME)

$(NAME): build
	@make up

build:
	@docker-compose -f ./docker-compose.yml build
		
up:
	@docker-compose -f ./docker-compose.yml up
	
down:
	@docker-compose -f ./docker-compose.yml down

re:
	@make down
	@make clean
	@make build
	@make up

clean: down
	@ { docker volume ls -q ; echo null; } | xargs -r docker volume rm --force
	@ docker images --filter=reference='$(NAME)*' -q | xargs -r docker rmi

.PHONY:	all re down clean up build